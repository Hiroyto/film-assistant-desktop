import { useState, useContext } from "react";
import { UserContext } from "../../App";
import Header from "../../components/header";
import { useMutation } from 'react-query';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import Footer from "../../components/footer";
import { Theme } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { isDesktop, openExternal } from "../../lib/ipcClient";
import { safeApiCall } from "../../models/apiHelpers";

// In-app pricing (2026-10-18). The plans and look follow the landing page's
// pricing section (components/landing.tsx, landing-v2.css). While the beta is
// free every button is off (FREE_BETA); flip it to sell again. Checkout sells
// the membership, the one-time token package and the member refill. Super has
// no Stripe product yet, so its button stays off either way.

type CheckoutEvent = 'member' | 'base' | 'discount';

const FREE_BETA = true;

const TITLE_FONT = "'adobe-thai', Georgia, serif";
const UI_FONT = "'Inter', sans-serif";
const MONO_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

interface Plan {
    name: string;
    price: string;
    unit: string;
    forWho: string;
    features: string[];
    popular?: boolean;
    checkout?: CheckoutEvent;
}

const PLANS: Plan[] = [
    {
        name: 'Member',
        price: '$8',
        unit: '/ month',
        forWho: 'For the writer focused on the writing and outlining experience, with lighter Peer usage.',
        features: ['Full studio: board, script, import, Peer', 'Monthly usage included', 'Member rate on refills ($5)'],
        popular: true,
        checkout: 'member',
    },
    {
        name: 'Super',
        price: '$20',
        unit: '/ month',
        forWho: 'For the writer leaning on the whole studio: heavy Peer usage and frequent imports of full-length scripts.',
        features: ['Everything in Member', 'Roomier monthly allowance for Peer notes', 'Import large scripts frequently'],
    },
    {
        name: 'Tokens',
        price: '$12',
        unit: 'one time',
        forWho: 'No subscription. The same studio, topped up whenever you need it.',
        features: ['Pay as you go', 'One-time purchase', 'Top up anytime'],
        checkout: 'base',
    },
];

const PRIMARY_BTN = 'inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[10px] bg-gradient-to-br from-[#FF8C42] to-[#FF6B35] text-white font-semibold text-[15px] shadow-[0_4px_20px_rgba(255,140,66,0.3)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0';
const GHOST_BTN = 'inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg border border-white/20 text-white/70 font-semibold text-[15px] transition-colors hover:text-white hover:border-white/40 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:text-white/70 disabled:hover:border-white/20';

export default function Pricing(props: any) {
    const { user, token, signOut } = useContext(UserContext);
    const [pending, setPending] = useState<CheckoutEvent | null>(null);
    const isMember = user?.subscription === 'member';

    // Desktop: after opening Stripe in the external browser, poll /user (5s/2min)
    // so the new subscription/cap is reflected here without waiting for the next
    // scheduled refresh (AD-04 polling half; the deep-link half needs Stripe config).
    const pollForSubscriptionChange = () => {
        const userId = token?.payload['cognito:username'];
        if (!userId) return;
        const email = token?.payload.email;
        const tok = token?.toString() ?? '';
        const baseSub = user?.subscription ?? null;
        const baseCap = user?.cap ?? null;
        const started = Date.now();
        const timer = setInterval(async () => {
            if (Date.now() - started > 120000) { clearInterval(timer); return; }
            const r = await safeApiCall('user', { email, userId }, tok);
            if (!r.success) return;
            const body = r.data?.body ?? {};
            if (body.subscription !== baseSub || body.cap !== baseCap) {
                clearInterval(timer);
                props.setUser?.((u: any) => (u ? { ...u, cap: body.cap, subscription: body.subscription } : u));
                toast.success('Subscription updated!');
            }
        }, 5000);
    };

    // Web: the legacy same-tab redirect. Desktop: Stripe opens in the OS browser —
    // redirecting the Electron window would strand the writer inside Stripe with
    // no way back (AD-04 / RISK-006) — and the account refreshes by polling.
    const handleCheckoutUrl = (url?: string) => {
        setPending(null);
        if (!url) { toast.error('Checkout unavailable'); return; }
        if (isDesktop()) {
            void openExternal(url);
            toast('Complete your purchase in your browser — your account will update here shortly.');
            pollForSubscriptionChange();
        } else {
            window.open(url, '_self');
        }
    };

    // One Stripe checkout per event; the Lambda answers with the session URL.
    const checkout = useMutation({
        mutationFn: (event: CheckoutEvent) => axios.post(
            `${process.env.REACT_APP_URL}/checkout`,
            {
                event,
                email: token?.payload.email,
                userId: token?.payload['cognito:username'],
            },
            { headers: { Authorization: token?.toString() } },
        ),
        onSuccess: (res: any) => {
            handleCheckoutUrl(res.data.headers.Location);
        },
        onError: () => {
            toast.error('Checkout could not start. Try again in a moment.');
            setPending(null);
        },
    });

    const start = (event: CheckoutEvent) => {
        setPending(event);
        checkout.mutate(event);
    };

    const buttonFor = (plan: Plan) => {
        const busy = !!plan.checkout && pending === plan.checkout;
        const cls = plan.popular ? PRIMARY_BTN : GHOST_BTN;
        if (!plan.checkout) {
            return <button type="button" className={cls} disabled>Coming soon</button>;
        }
        if (FREE_BETA) {
            return <button type="button" className={GHOST_BTN} disabled>{plan.checkout === 'member' ? 'Become a member' : 'Buy tokens'}</button>;
        }
        if (plan.checkout === 'member' && isMember) {
            return <button type="button" className={cls} disabled>Your plan</button>;
        }
        const label = plan.checkout === 'member' ? 'Become a member' : 'Buy tokens';
        return (
            <button type="button" className={cls} disabled={pending !== null} onClick={() => start(plan.checkout!)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Opening checkout' : label}
            </button>
        );
    };

    return (
        <Theme appearance="dark">
            <div className="bg-gradient-to-br from-bgdark1 to-bgdark2 min-h-screen flex flex-col text-white" style={{ fontFamily: UI_FONT }}>
                <Header signOut={signOut} />
                <main className="flex-1 w-full max-w-[1120px] mx-auto px-4 md:px-8 pt-[140px] pb-24">
                    <h1 className="m-0 text-[clamp(1.9rem,4vw,2.9rem)] leading-[1.12] font-normal text-white" style={{ fontFamily: TITLE_FONT }}>
                        Plans
                    </h1>
                    {FREE_BETA && (
                        <p className="m-0 mt-3 max-w-[62ch] text-[1.05rem] leading-[1.7] text-white/70">
                            FilmAssistant is free while it's in beta, so there's nothing to buy yet. These plans start when the beta ends.
                        </p>
                    )}

                    <div className="mt-11 grid grid-cols-1 lg:grid-cols-3 gap-[26px]">
                        {PLANS.map((plan) => (
                            <section
                                key={plan.name}
                                aria-labelledby={`plan-${plan.name}`}
                                className={`relative flex flex-col rounded-[14px] border px-8 py-[34px] ${plan.popular
                                    ? 'border-[rgba(255,107,53,0.55)] bg-[linear-gradient(160deg,rgba(255,107,53,0.08),#141210_55%)]'
                                    : 'border-white/10 bg-[#141210]'}`}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-[30px] rounded px-2.5 py-1 bg-[#ff6b35] text-[#180b04] text-[0.63rem] font-bold tracking-[0.16em]" style={{ fontFamily: MONO_FONT }}>
                                        MOST POPULAR
                                    </div>
                                )}
                                <h2 id={`plan-${plan.name}`} className="m-0 text-[1.15rem] font-semibold text-[#f2ede6]">{plan.name}</h2>
                                <div className="mt-2.5 mb-0.5 text-[2.9rem] leading-none font-normal text-[#ff6b35]" style={{ fontFamily: TITLE_FONT }}>
                                    {plan.price} <small className="text-[0.85rem] font-normal text-white/40" style={{ fontFamily: UI_FONT }}>{plan.unit}</small>
                                </div>
                                <p className="mt-2.5 mb-0 text-[0.88rem] leading-[1.6] text-white/55 lg:min-h-[4.8em]">{plan.forWho}</p>
                                <ul className="list-none p-0 mt-[18px] mb-6">
                                    {plan.features.map((f) => (
                                        <li key={f} className="py-1.5 text-[0.9rem] text-white/65">
                                            <span className="font-bold text-[#8dbf7e] mr-2" aria-hidden="true">✓</span>{f}
                                        </li>
                                    ))}
                                </ul>
                                <div className="mt-auto">{buttonFor(plan)}</div>
                            </section>
                        ))}
                    </div>

                    <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-white/10 bg-[#141210] px-8 py-5">
                        <div>
                            <div className="text-[1.05rem] font-semibold text-[#f2ede6]">
                                Member refill <span className="ml-2 text-[#ff6b35] font-normal" style={{ fontFamily: TITLE_FONT, fontSize: '1.6rem' }}>$5</span>
                                <small className="ml-1.5 text-[0.85rem] font-normal text-white/40">one time</small>
                            </div>
                            <p className="m-0 mt-1 text-[0.88rem] text-white/55">Members top up at the member rate.</p>
                        </div>
                        {FREE_BETA ? (
                            <button type="button" className={GHOST_BTN} disabled>Buy a refill</button>
                        ) : isMember ? (
                            <button type="button" className={GHOST_BTN} disabled={pending !== null} onClick={() => start('discount')}>
                                {pending === 'discount' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                {pending === 'discount' ? 'Opening checkout' : 'Buy a refill'}
                            </button>
                        ) : (
                            <button type="button" className={GHOST_BTN} disabled>For members</button>
                        )}
                    </div>
                </main>
                <Footer />
            </div>
        </Theme>
    );
}
