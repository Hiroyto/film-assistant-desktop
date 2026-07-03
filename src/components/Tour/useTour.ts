// useTour.ts
"use client";

import { useContext } from "react";
import { TourContext } from "./TourProvider";

export const useTour = () => {
    const ctx = useContext(TourContext);

    if (!ctx) {
        throw new Error("useTour must be used inside TourProvider");
    }

    return ctx;
};