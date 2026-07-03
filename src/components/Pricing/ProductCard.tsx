import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import React, { useState } from "react";

type ProductCardProps = {
  title: string;
  price: string;
  type: string;
  features: string[];
  badge: boolean;
  buttonText: string;
  onAction: (actionType: string) => void;
  userSubscriptionType: string;
  loading: boolean
};

export default function ProductCard({
  title,
  price,
  type,
  features,
  badge,
  buttonText,
  onAction,
  userSubscriptionType,
  loading
}: ProductCardProps) {
  const memberOnly = type === "refill" && userSubscriptionType !== "member";
  const currentPlan = type === "/month" && userSubscriptionType === "member";
  const isDisabled = memberOnly || currentPlan || loading;

  const handleActionClick = async () => {
    if (isDisabled) return;
    try {
      await onAction(type);
    } catch (error) {
      console.error("Action failed:", error);
    }
  };

  const renderButtonContent = () => {
    if (loading) {
      return (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Processing...
        </span>
      );
    }
    if (memberOnly) {
      return "Member Access Only";
    }
    if (currentPlan) {
      return "Current Plan";
    }
    return buttonText;
  };

  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={`flex flex-col w-full max-w-[500px] mx-auto lg:mx-0 rounded-2xl p-8 shadow-md border font-system backdrop-blur-md hover:border-hoverOrangeBorder hover:shadow-[0_4px_12px_rgba(255,107,53,0.4)]
        ${badge
          ? "border-hoverOrangeBorder border-[3px] bg-[linear-gradient(135deg,rgba(255,107,53,0.12)_0%,rgba(255,140,66,0.08)_100%)]"
          : "border-orangeBorder bg-glassBg"
        }`
      }
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white text-xs font-semibold px-6 py-2 rounded-[20px] shadow-[0_4px_12px_rgba(255,107,53,0.4)] uppercase tracking-wide">
          Most Popular
        </div>
      )}
      <div className="text-center mb-8 pb-6 border-b border-white/10">
        <h2 className={"text-2xl font-semibold mb-4 text-white"}>
          {title}
        </h2>
        <div className="text-5xl font-bold text-orange">
          ${price}
          <span className="text-base text-gray-500"> {type}</span>
        </div>
      </div>

      <ul className="list-none my-6 flex-grow">
        {features.map((feature, idx) => (
          <li key={idx} className="flex items-center gap-3 py-3 text-fontWhite text-base">
            <Check size={18} className="text-green-500" />
            {feature}
          </li>
        ))}
      </ul>
      <button
        onClick={handleActionClick}
        className={`[font-family:Arial,Helvetica,sans-serif!important] w-full p-4 text-white rounded-[10px] font-semibold text-base leading-[18px] transition-all duration-300 ease-in-out 
    shadow-[0_4px_12px_rgba(255,107,53,0.3)]
    ${isDisabled
            ? "opacity-50 cursor-not-allowed transform-none bg-[rgba(255,107,53,0.15)] border-[2px] border-[rgba(255,107,53,0.4)] text-[#ff6b35]"
            : "bg-gradient-to-br from-[#ff6b35] to-[#ff8c42] cursor-pointer hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)]"
          }`}
        disabled={isDisabled}
      >
        {renderButtonContent()}
      </button>
    </motion.div>
  );
}
