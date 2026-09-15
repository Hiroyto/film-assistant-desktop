// useFdxSync — assinatura React do motor headless do cowork .fdx (lib/fdxSync).
import { useEffect, useState } from 'react';
import { getFdxSyncSnapshot, subscribeFdxSync, type FdxSyncSnapshot } from '../../lib/fdxSync';

export function useFdxSync(): FdxSyncSnapshot {
  const [snap, setSnap] = useState<FdxSyncSnapshot>(getFdxSyncSnapshot);
  useEffect(() => {
    setSnap(getFdxSyncSnapshot());
    return subscribeFdxSync(() => setSnap(getFdxSyncSnapshot()));
  }, []);
  return snap;
}
