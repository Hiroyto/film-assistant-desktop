// lib/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { isCharacterWsChannelArmed, subscribeTestWs } from './wsTestChannel';

interface CharacterUpdateData {
    characters: any[];
    storyId: string;
    analysisComplete: boolean;
    timestamp?: string;
    requestId?: string;
    // FIL-315: Added for screenplay character analysis
    trigger?: string;
    tokenInfo?: {
        cost: number;
        newBalance: number;
    };
}

interface WebSocketMessage {
    type: string;
    data: CharacterUpdateData | any;
    timestamp: number;
}

// BC-10 (BR-MIGRAR-046): reconnect 5x com base 3000ms online; após esgotar, NÃO
// desiste — degrada para backoff estendido (30s, 1min, 5min) e reseta no evento
// OS `online`. Helper puro para teste.
export const ONLINE_MAX_ATTEMPTS = 5;
export const ONLINE_BASE_DELAY = 3000;
export const EXTENDED_DELAYS = [30_000, 60_000, 300_000]; // 30s, 1min, 5min (cap)

export function computeReconnectDelay(attempt: number): number {
    if (attempt <= ONLINE_MAX_ATTEMPTS) {
        return ONLINE_BASE_DELAY * Math.pow(1.5, attempt - 1);
    }
    const idx = Math.min(attempt - ONLINE_MAX_ATTEMPTS - 1, EXTENDED_DELAYS.length - 1);
    return EXTENDED_DELAYS[idx];
}

export const useWebSocket = (userId: string, storyId: string) => {
    const ws = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<CharacterUpdateData | null>(null);
    const [error, setError] = useState<string | null>(null);
    
    // 🆕 Keep-alive and reconnection refs
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const maxReconnectAttempts = 5; // base online; depois degrada (computeReconnectDelay)
    
    // 🆕 Cleanup function to clear all intervals and timeouts
    const cleanup = useCallback(() => {
        console.log('🧹 Cleaning up WebSocket resources');
        
        // Clear ping interval
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }
        
        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);
    
    const connect = useCallback(() => {
        // Don't connect if missing required params or already connected
        if (!userId || !storyId) {
            console.log('⏸️ WebSocket: Missing userId or storyId, skipping connection');
            return;
        }
        
        // Check if already connected
        if (ws.current?.readyState === WebSocket.OPEN) {
            console.log('✅ WebSocket already connected');
            return;
        }
        
        // Check if connecting
        if (ws.current?.readyState === WebSocket.CONNECTING) {
            console.log('⏳ WebSocket already connecting...');
            return;
        }
        
        // Validate WebSocket endpoint
        const wsUrl = process.env.REACT_APP_WEBSOCKET_ENDPOINT;
        
        if (!wsUrl) {
            console.error('❌ WebSocket endpoint not configured! Set REACT_APP_WEBSOCKET_ENDPOINT in .env');
            setError('WebSocket endpoint not configured');
            return;
        }
        
        console.log('🔌 Connecting to WebSocket:', wsUrl, { userId, storyId });
        
        // Clean up any previous connection
        cleanup();
        
        try {
            ws.current = new WebSocket(wsUrl);
            
            ws.current.onopen = () => {
                console.log('✅ WebSocket connected');
                setIsConnected(true);
                setError(null);
                reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
                
                // Send identification message
                ws.current?.send(JSON.stringify({
                    action: 'identify',
                    userId,
                    storyId,
                    timestamp: Date.now()
                }));
                
                // 🆕 Start ping interval (every 5 minutes to keep connection alive)
                console.log('🏓 Starting keep-alive ping interval (every 5 minutes)');
                pingIntervalRef.current = setInterval(() => {
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        console.log('🏓 Sending ping to keep connection alive');
                        ws.current.send(JSON.stringify({
                            action: 'ping',
                            timestamp: Date.now()
                        }));
                    } else {
                        console.log('⚠️ Cannot send ping - WebSocket not open');
                    }
                }, 5 * 60 * 1000); // 5 minutes
            };
            
            ws.current.onmessage = (event) => {
                console.log('📥 WebSocket message received:', event.data);
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);
                    
                    switch (message.type) {
                        case 'character-update':
                            console.log('Character update received:', {
                              characterCount: message.data.characters?.length,
                              storyId: message.data.storyId,
                              analysisComplete: message.data.analysisComplete,
                              timestamp: message.data.timestamp
                            });
                            // Force new reference by spreading
                            setLastUpdate({ ...message.data, _receivedAt: Date.now() });
                            break;
                            
                        case 'character-error':
                            console.error('❌ Character analysis error:', message.data);
                            setError(`Character analysis failed: ${message.data.error}`);
                            break;
                            
                        case 'connection-ack':
                            console.log('🤝 Connection acknowledged by server');
                            break;
                            
                        case 'pong':
                            console.log('🏓 Pong received from server');
                            break;
                            
                        default:
                            console.log('📨 Unknown message type:', message.type);
                    }
                } catch (error) {
                    console.error('💥 Failed to parse WebSocket message:', error);
                    setError('Failed to parse message');
                }
            };
            
            ws.current.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                });
                
                setIsConnected(false);
                cleanup(); // Clear intervals when connection closes
                
                // Reconnection com backoff (BR-MIGRAR-046): online 5x/3000ms, depois
                // estendido (30s/1min/5min) — NÃO desiste; degrada para "offline mode".
                if (event.code !== 1000 && event.code !== 1001) { // Not a normal closure
                    reconnectAttemptsRef.current++;
                    const delay = computeReconnectDelay(reconnectAttemptsRef.current);
                    const extended = reconnectAttemptsRef.current > maxReconnectAttempts;

                    if (extended) {
                        // Degradou para offline mode — sinaliza, mas continua tentando.
                        setError('Offline — retrying connection in background');
                    }
                    console.log(
                        `🔄 Reconnection attempt ${reconnectAttemptsRef.current}` +
                        `${extended ? ' (extended/offline)' : `/${maxReconnectAttempts}`} in ${delay}ms`,
                    );

                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, delay);
                } else {
                    console.log('✅ Normal WebSocket closure');
                }
            };
            
            ws.current.onerror = (error) => {
                console.error('💥 WebSocket error:', error);
                setError('WebSocket connection error');
                setIsConnected(false);
            };
            
        } catch (error) {
            console.error('💥 Failed to create WebSocket:', error);
            setError('Failed to create WebSocket connection');
        }
    }, [userId, storyId, cleanup]);
    
    const disconnect = useCallback(() => {
        if (ws.current) {
            console.log('🔌 Manually disconnecting WebSocket');
            cleanup(); // Clear intervals before disconnecting
            ws.current.close(1000, 'User disconnect');
            ws.current = null;
        }
    }, [cleanup]);
    
    // 🆕 Manual reconnect function (useful for UI retry button)
    const reconnect = useCallback(() => {
        console.log('🔄 Manual reconnection requested');
        reconnectAttemptsRef.current = 0; // Reset attempts for manual reconnect
        disconnect();
        setTimeout(connect, 100); // Small delay to ensure cleanup
    }, [connect, disconnect]);
    
    // Main connection effect
    useEffect(() => {
        if (userId && storyId) {
            connect();
        } else {
            disconnect();
        }

        return () => {
            disconnect();
        };
    }, [connect, disconnect, userId, storyId]);

    // Parity test (spec 05): injeções de WS percorrem o MESMO caminho de um
    // 'character-update' real (setLastUpdate). Inerte em produção (canal não armado).
    useEffect(() => {
        if (!isCharacterWsChannelArmed()) return;
        return subscribeTestWs((data) => {
            setLastUpdate({ ...data, _receivedAt: Date.now() } as unknown as CharacterUpdateData);
        });
    }, []);
    
    // 🆕 Page visibility change handler - reconnect when tab becomes active
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isConnected && userId && storyId) {
                console.log('📱 Page became visible, checking WebSocket connection');
                
                // Check if WebSocket needs reconnection
                if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                    console.log('🔄 Reconnecting after page became visible');
                    reconnectAttemptsRef.current = 0; // Reset attempts
                    connect();
                }
            } else if (document.visibilityState === 'hidden') {
                console.log('📱 Page became hidden');
            }
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Also check on focus
        const handleFocus = () => {
            if (!isConnected && userId && storyId) {
                console.log('🔍 Window focused, checking WebSocket connection');
                if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                    reconnectAttemptsRef.current = 0;
                    connect();
                }
            }
        };
        
        window.addEventListener('focus', handleFocus);

        // BR-MIGRAR-046: ao voltar online (OS event), reseta o contador de tentativas
        // (sai do backoff estendido) e reconecta imediatamente.
        const handleOnline = () => {
            if (userId && storyId) {
                console.log('🌐 OS online — resetting reconnect attempts');
                reconnectAttemptsRef.current = 0;
                if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                    connect();
                }
            }
        };
        window.addEventListener('online', handleOnline);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('online', handleOnline);
        };
    }, [isConnected, userId, storyId, connect]);
    
    // 🆕 Debug logging for connection state
    useEffect(() => {
        const interval = setInterval(() => {
            if (ws.current) {
                const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
                console.log(`📊 WebSocket state: ${states[ws.current.readyState]} (${ws.current.readyState})`);
            }
        }, 30000); // Log every 30 seconds
        
        return () => clearInterval(interval);
    }, []);
    
    return { 
        isConnected, 
        lastUpdate, 
        error,
        reconnect // Expose manual reconnect for UI
    };
};