import React from 'react';
import { Dialog } from '@radix-ui/themes';

import { Theme, Flex } from '@radix-ui/themes';
import { useState } from "react";
import DeleteDialog from '../ui/DeleteDialog';

interface StoryCardProps {
    title: string;
    category: string;
    lastModified: string;
    description: string;
    onClick?: () => void;
    onDelete?: () => void;
}

const StoryCard: React.FC<StoryCardProps> = ({
    title,
    category,
    lastModified,
    description,
    onClick,
    onDelete,
}) => {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (onClick) onClick();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") handleCardClick(e as any);
    };

    const handleDeleteClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        setDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        setDeleteDialogOpen(false);
        if (onDelete) {
            onDelete(); // propaga a ação para o componente pai
        }
    };
    // function formatDate(dateString: string) {
    //     const date = new Date(dateString);
    //     console.log("DATA FINAL: ", date.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }))
    //     return date.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    //     // .replace(' de ', ' ');
    // }

    function formatDate(dateString: string) {
        const date = new Date(dateString);
        return date.toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric"
        });
    }
    return (
        <Theme>
            <div
                role="button"
                tabIndex={0}
                onClick={handleCardClick}
                onKeyDown={handleKeyDown}
                className="bg-glassBg border border-orange02 rounded-[12px] p-6 transition-all duration-300 ease-in-out cursor-pointer relative
                group hover:bg-[rgba(255,255,255,0.12)] hover:border-[rgba(255,107,53,0.5)] hover:-translate-y-0.5 hover:shadow-[0_8px_16px_rgba(255,107,53,0.2)]">

                <div className="flex justify-between items-start mb-4">
                    <h4 className="text-[1.1rem] text-white font-medium flex-1 pr-4">{title}</h4>
                    <button
                        onClick={handleDeleteClick}
                        className="w-[28px] h-[28px] bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.3)] rounded-[6px] flex items-center justify-center text-[#ef4444] cursor-pointer transition-all duration-200 ease-in-out flex-shrink-0 
                        hover:bg-[rgba(239,68,68,0.3)] hover:scale-110"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </div>
                <div className="flex flex-col gap-2">
                    <div className="bg-orange02 text-orange py-1 px-3 rounded-[8px] text-xs inline-block mb-2">{category}</div>
                    <div className="text-xs text-white/50">Last modified: {formatDate(lastModified)}</div>
                    <div className="max-h-0 opacity-0 overflow-hidden transition-all duration-300 ease-in-out text-[0.85rem] leading-[1.5] text-white/70 mt-0
                group-hover:max-h-[200px] group-hover:opacity-100 group-hover:mt-4">{description}</div>
                </div>
            </div>
            {/* =================================================================
                    DELETE DIALOG
                    Still using the old one checking for possible own components
                ================================================================= */}
            <DeleteDialog
                openTrigger={deleteDialogOpen}
                onTriggerConsumed={() => setDeleteDialogOpen(false)}
                onConfirm={confirmDelete}
            />
            <Dialog.Root>

                <Dialog.Content style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '1rem',
                    padding: '2rem',
                    boxShadow: '0 0.5rem 1rem rgba(0, 0, 0, 0.1)',
                    maxWidth: '30rem',
                    margin: 'auto',
                    color: 'black',
                    zIndex: 15,
                }}>
                    <Dialog.Title style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
                        Confirm Deletion
                    </Dialog.Title>
                    <Dialog.Description style={{ marginBottom: '2rem', fontSize: '1rem' }}>
                        Are you sure you want to delete this work?
                    </Dialog.Description>
                    <Flex justify="end" gap="2">
                        {/* Cancel button */}
                        <Dialog.Close>
                            <button
                                className="pricing-button"
                                style={{
                                    backgroundColor: '#FF4B2B',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '0.75rem 1.5rem',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                        </Dialog.Close>
                        {/* Confirm delete button */}
                        <button
                            className="pricing-button"
                            style={{
                                backgroundColor: '#FF4B2B',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '0.75rem 1.5rem',
                                cursor: 'pointer'
                            }}
                            onClick={confirmDelete}
                        >
                            Delete
                        </button>
                    </Flex>
                </Dialog.Content>
            </Dialog.Root>
        </Theme>

    );
};

export default StoryCard;
