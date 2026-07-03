import React, { forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

type PricingTier = {
  title: string;
  price: string;
  period: string;
  features: string[];
  isPopular?: boolean;
  buttonText: string;
  disabled?: boolean;
};

const pricingTiers: PricingTier[] = [
  {
    title: "Member",
    price: "8.00",
    period: "/month",
    features: [
      "~750 generations per month",
      "Participate in Weekly Contests",
      "Better Rate on Tokens",
      "Cheaper Token Refills"
    ],
    isPopular: true,
    buttonText: "Buy Plan"
  },
  {
    title: "Base Token Package",
    price: "12.00",
    period: "one-time",
    features: [
      "~750 generations",
      "Create more stories",
      "Create more summaries",
      "One time purchase"
    ],
    buttonText: "Buy Tokens"
  },
  {
    title: "Member Token Refill",
    price: "5.00",
    period: "refill",
    features: [
      "~750 generations",
      "Member discount applied",
      "One time purchase",
      "Member access only"
    ],
    buttonText: "Member Access Only",
    disabled: true
  }
];

type PricingCardProps = {
  tier: PricingTier;
  onAction: () => void;
};

const PricingCard: React.FC<PricingCardProps> = ({ tier, onAction }) => {
  const isDisabled = tier.disabled;

  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={`relative flex flex-col w-full max-w-[500px] mx-auto lg:mx-0 rounded-2xl p-8 shadow-md border font-system backdrop-blur-md hover:border-[rgba(255,107,53,0.6)] hover:shadow-[0_4px_12px_rgba(255,107,53,0.4)]
        ${tier.isPopular
          ? "border-[rgba(255,107,53,0.6)] border-[3px] bg-[linear-gradient(135deg,rgba(255,107,53,0.12)_0%,rgba(255,140,66,0.08)_100%)]"
          : "border-[rgba(255,107,53,0.3)] bg-[rgba(20,20,20,0.8)]"
        }`
      }
    >
      {tier.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white text-xs font-semibold px-6 py-2 rounded-[20px] shadow-[0_4px_12px_rgba(255,107,53,0.4)] uppercase tracking-wide">
          Most Popular
        </div>
      )}
      
      <div className="text-center mb-8 pb-6 border-b border-white/10">
        <h2 className="text-2xl font-semibold mb-4 text-white">
          {tier.title}
        </h2>
        <div className="text-5xl font-bold text-[#ff6b35]">
          ${tier.price}
          <span className="text-base text-gray-500"> {tier.period}</span>
        </div>
      </div>

      <ul className="list-none my-6 flex-grow">
        {tier.features.map((feature, idx) => (
          <li key={idx} className="flex items-center gap-3 py-3 text-white/90 text-base">
            <Check size={18} className="text-green-500" />
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={onAction}
        className={`[font-family:Arial,Helvetica,sans-serif!important] w-full p-4 text-white rounded-[10px] font-semibold text-base leading-[18px] transition-all duration-300 ease-in-out 
          shadow-[0_4px_12px_rgba(255,107,53,0.3)]
          ${isDisabled
            ? "opacity-50 cursor-not-allowed transform-none bg-[rgba(255,107,53,0.15)] border-[2px] border-[rgba(255,107,53,0.4)] text-[#ff6b35]"
            : "bg-gradient-to-br from-[#ff6b35] to-[#ff8c42] cursor-pointer hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)]"
          }`}
        disabled={isDisabled}
      >
        {tier.buttonText}
      </button>
    </motion.div>
  );
};

const LandingPricingSection = forwardRef<HTMLElement>((_, ref) => {
  const navigate = useNavigate();

  const handleAction = () => {
    navigate('/login');
  };

  return (
    <section className="bg-[#0a0a0a] py-24 px-8" ref={ref}>
      <div className="max-w-[1200px] mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-semibold text-white mb-4 font-['Inter',sans-serif]">
            Choose Your Plan
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {pricingTiers.map((tier, index) => (
            <PricingCard
              key={index}
              tier={tier}
              onAction={handleAction}
            />
          ))}
        </div>
      </div>
    </section>
  );
});

LandingPricingSection.displayName = 'LandingPricingSection';

export default LandingPricingSection;