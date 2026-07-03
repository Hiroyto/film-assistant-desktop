import { products } from "../../models/products";
import { useState, useContext, useEffect } from "react";
import { UserContext } from "../../App";
import ProductCard from "../../components/Pricing/ProductCard";
import Header from "../../components/header";
import { useMutation } from 'react-query';
import { toast, Toaster } from 'react-hot-toast'
import axios from 'axios';
import Footer from "../../components/footer";
import { Theme } from "@radix-ui/themes";
import { isDesktop, openExternal } from "../../lib/ipcClient";
import { safeApiCall } from "../../models/apiHelpers";

export default function Pricing(props: any) {
    const { user, token, signOut } = useContext(UserContext);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    useEffect(() => {
        setLoadingAction(null);
    }, []);

    const handleAction = async (actionType: string): Promise<void> => {
        setLoadingAction(actionType);
        try {
            switch (actionType) {
                case "/month":
                    await subscribe.mutateAsync();
                    break;

                case "one-time":
                    await refill.mutateAsync();
                    break;

                case "refill":
                    await refill_discount.mutateAsync();
                    break;

                default:
                    console.warn("Unknown action:", actionType);
            }
        } catch (error) {
            toast.error("Something went wrong");
        }
    };

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

    const handleCheckoutUrl = (url?: string) => {
        setLoadingAction(null);
        if (!url) { toast.error('Checkout unavailable'); return; }
        if (isDesktop()) {
            // Open Stripe in the OS browser — redirecting the Electron window would
            // strand the user inside Stripe with no way back (AD-04 / RISK-006).
            void openExternal(url);
            toast('Complete your purchase in your browser — your account will update here shortly.');
            pollForSubscriptionChange();
        } else {
            window.open(url, '_self'); // web: legacy redirect
        }
    };

    const member = async () => {
        return await axios.post(
            `${process.env.REACT_APP_URL}/checkout`,
            {
                "event": "member",                              // Tells Lambda which plan
                "email": token?.payload.email,                  // User's email for receipt
                "userId": token?.payload['cognito:username']    // For updating DynamoDB after payment
            },
            { headers: { "Authorization": token?.toString() } }
        );
    };

    const subscribe = useMutation({
        mutationFn: member,
        onSuccess: (res: any) => {
            handleCheckoutUrl(res.data.headers.Location);
        },
        onError: () => {
            toast.error("error");
            setLoadingAction(null);
        },
    });


    /**
     * Creates Stripe checkout for base token package
     * Same structure as member() above
     */
    const base = async () => {
        return await axios.post(
            `${process.env.REACT_APP_URL}/checkout`,
            {
                "event": "base",
                "email": token?.payload.email,
                "userId": token?.payload['cognito:username']
            },
            { headers: { "Authorization": token?.toString() } }
        );
    };

    const refill = useMutation({
        mutationFn: base,
        onSuccess: (res: any) => {
            handleCheckoutUrl(res.data.headers.Location);
            setLoadingAction(null);
        },
        onError: () => {
            toast.error("error");
            setLoadingAction(null);
        },
    });

    /**
     * Creates Stripe checkout for discounted member refill
     * Same structure as above
     */
    const discount = async () => {
        return await axios.post(
            `${process.env.REACT_APP_URL}/checkout`,
            {
                "event": "discount",
                "email": token?.payload.email,
                "userId": token?.payload['cognito:username']
            },
            { headers: { "Authorization": token?.toString() } }
        );
    };

    const refill_discount = useMutation({
        mutationFn: discount,
        onSuccess: (res: any) => {
            handleCheckoutUrl(res.data.headers.Location);
            setLoadingAction(null);
        },
        onError: () => {
            toast.error("error");
            setLoadingAction(null);
        },
    });

    const userSubscriptionType = user?.subscription;
    return (
        <Theme>
            <div className="bg-gradient-to-br from-bgdark1 to-bgdark2 pt-10 min-h-screen flex flex-col">
                <Header signOut={signOut} />
                <div className="flex-1">
                    <div className="max-w-[1400px] px-6 text-center mx-auto pt-[75px]">
                        <h1 className="text-5xl font-bold text-white mb-12 font-system">
                            Choose Your Plan
                        </h1>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                            {products.map((product, index) => (
                                <ProductCard
                                    key={index}
                                    title={product.title}
                                    price={product.price}
                                    type={product.type}
                                    features={product.features}
                                    badge={product.badge}
                                    buttonText={product.buttonText}
                                    onAction={handleAction}
                                    userSubscriptionType={userSubscriptionType}
                                    loading={loadingAction === product.type}
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <Footer />
            </div>
        </Theme>
    );
}