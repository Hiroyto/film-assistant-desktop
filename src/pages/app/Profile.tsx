import { useState, useContext, useEffect, useCallback } from "react";
import { Header } from "../../components/header";
import { UserContext } from "../../App";
import UserInfoItem from "../../components/ui/UserInfo";
import StoryGrid from "../../components/Profile/StoryGrid";
import { Dialog } from '@radix-ui/themes';
import { Theme, Flex, Text, Button, Tooltip } from '@radix-ui/themes';
import { useMutation } from "react-query";
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { User } from '../../models/user'
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useNavigate } from 'react-router-dom';
import { Settings, CreditCard } from "lucide-react";
import Footer from "../../components/footer";
import { isDesktop, openExternal } from "../../lib/ipcClient";
import { useStoryUI } from "../../components/ui/StoryUIContext";


function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    // .replace(' de ', ' ');
}

export default function Profile(props: any) {
    const { authStatus, signOut: amplifySignOut } = useAuthenticator((context) => [context.authStatus]);
    const { user, setUser, signOut, token, data, setData, debouncedSave, zeroLength } = useContext(UserContext);
    const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
    const [deletingItems, setDeletingItems] = useState(new Set<string>());
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { setStoryChangeSource } = useStoryUI();

    const handleDynamoUser = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.post(
                `${process.env.REACT_APP_URL}/user`,
                {
                    email: token.payload.email,
                    userId: token.payload["cognito:username"],
                },
                { headers: { Authorization: token.toString() } }
            );

            setUser((prev: User) => ({
                ...prev,
                cap: res.data.body.cap,
                subscription: res.data.body.subscription,
                sign_up_date: res.data.body.sign_up_date,
                works: res.data.body.works ?? {},
                privacy: res.data.body.privacy,
            }));
        } catch (error) {
            toast.error("Erro ao carregar dados do usuário");
        } finally {
            setLoading(false);
        }
    }, [setUser, token]);


    useEffect(() => {
        handleDynamoUser();
    }, [handleDynamoUser]);

    // Handle opening Stripe Customer Portal for membership management
    const handleManageMembership = () => {
        const billingUrl = process.env.REACT_APP_STRIPE_PORTAL_URL;
        if (!billingUrl) {
            toast.error("Billing portal URL not configured");
            return;
        }
        if (isDesktop()) {
            // Open the Stripe portal in the OS browser (AD-04) — redirecting the
            // Electron window would strand the user.
            void openExternal(billingUrl);
            toast('Opening the billing portal in your browser…');
        } else {
            window.open(billingUrl, "_self");
        }
    };

    const handleDeleteStory = (storyId: string) => {
        deleteWork.mutate(storyId);
    };

    const deleteWork = useMutation({
        mutationFn: async (storyIds: Set<string> | string) => {
            const storyIdsArray = storyIds instanceof Set ? Array.from(storyIds) : [storyIds];
            const isDeletingCurrentWork = storyIdsArray.includes(data.storyId);
            const res = await handleDeletion(storyIds)
            return { res, isDeletingCurrentWork };
        },
        onMutate: (storyIds: Set<string> | string) => {
            if (storyIds instanceof Set) {
                setDeletingItems(new Set([...deletingItems, ...storyIds]));
            } else {
                setDeletingItems(new Set([...deletingItems, storyIds]));
            }
        },

        onSuccess: async (result: { res: any; isDeletingCurrentWork: boolean }) => {
            const { res, isDeletingCurrentWork } = result;

            if (res.data.statusCode === 200) {
                toast.success("Work deleted!");

                // Atualiza dados mais recentes do usuário
                await handleDynamoUser();
                if (isDeletingCurrentWork) {
                    const generateStoryId = () => `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

                    const empty = {
                        storyId: generateStoryId(),
                        title: "",
                        M: "",
                        T: "",
                        G: "",
                        CQ: "",
                        SUM: "",
                        S1: "",
                        S2: "",
                        S3: "",
                        S4: "",
                        S5: "",
                        S6: "",
                        S7: "",
                        S8: "",
                        S9: "",
                    };
                    setData(empty);
                    debouncedSave(empty);
                }

                setDeletingItems(new Set());
            } else if (res.data.statusCode === 400) {
                toast.error(res.data.body.error);
            } else {
                toast.error("error");
            }
        },
        onError: (error: any) => {
            toast.error("error");
            setDeletingItems(new Set());
        },
    });

    const handleDeletion = async (storyIds: Set<string> | string) => {
        const storyIdsToDelete = storyIds instanceof Set ? Array.from(storyIds) : [storyIds];

        return await axios.post(`${process.env.REACT_APP_URL}/works`, {
            "event": "delete", // Tells the Lambda function what to do
            "storyIds": storyIdsToDelete, // Array of story IDs to delete
            "userId": token?.payload['cognito:username'], // User authentication
        },
            { headers: { "Authorization": token.toString() } } // JWT token for auth
        );
    }

    // const handleLoadWork = (storyId: string) => {
    //     loadWork.mutate(storyId);
    // };

    const loadWork = async (storyId: string) => {
        try {
            // Auto-save current work if it has any content
            if (data.title && data.storyId && Object.values(data).some(value =>
                typeof value === 'string' && value.trim() !== ""
            )) {
                console.log('🔄 Auto-saving current work before switching stories');
                await mutateSave.mutateAsync(data.title);
                toast.success(`Saved current work: ${data.title}`);
            }
            // Load the new story
            executeLoad(storyId);
        } catch (error) {
            console.error('Error auto-saving before switch:', error);
            // Still proceed to load even if save fails
            executeLoad(storyId);
        }
    };

    const mutateSave = useMutation({
        mutationFn: (title: string) => {
            return save(title);
        },
        onSuccess: (res: any) => {
            if (res.data.statusCode === 200) {
                // Update the user's works list with the response
                setUser((user: User) => ({ ...user, works: res.data.body.works }));
            }
        },
        onError: (error: any) => {
            console.log("error");
        },
    });

    const executeLoad = (storyId: string) => {
        const storyData = user?.works[storyId];
        if (storyData) {
            setStoryChangeSource("user");
            setData(storyData);
            debouncedSave(storyData);
            navigate('/home');
            toast.success(`Loaded story: ${storyData.title}`);
        } else {
            toast.error("Story not found");
        }
    };

    const save = async (title: string) => {
        const payload: any = {
            "event": "save",
            "title": title,
            "userId": token?.payload['cognito:username'],
            // All story segments (M = Mood/Setting, T = Theme, G = Genre, etc.)
            "M": data.M,
            "T": data.T,
            "G": data.G,
            "CQ": data.CQ,
            "SUM": data.SUM,
            "S1": data.S1,
            "S2": data.S2,
            "S3": data.S3,
            "S4": data.S4,
            "S5": data.S5,
            "S6": data.S6,
            "S7": data.S7,
            "S8": data.S8,
            "S9": data.S9
        };

        // Include storyId if it exists (for updates vs. new stories)
        if (data.storyId) {
            payload.storyId = data.storyId;
        }

        return await axios.post(`${process.env.REACT_APP_URL}/works`, payload, {
            headers: { "Authorization": token?.toString() }
        });
    }


    return (
        <Theme appearance="dark">
            <div className="min-h-screen flex flex-col font-system bg-gradient-to-br from-bgdark1 to-bgdark2 text-white">
                <Header signOut={signOut} />

                {/* CONTEÚDO PRINCIPAL */}
                <div className="flex-1 p-8 pb-0 pt-[107px]">
                    <h1 className="text-5xl font-bold text-white mb-12 text-center">
                        Profile
                    </h1>

                    <div className="flex flex-col items-center max-w-[1400px] mx-auto gap-8 mb-20">
                        <div className="w-full border-orangeBorder border-[2px] rounded-[16px] p-8 backdrop-blur-md bg-[linear-gradient(135deg,rgba(255,107,53,0.1)_0%,rgba(255,140,66,0.05)_100%)]">
                            <div className="flex md:flex-row flex-col md:gap-0 gap-4 justify-between items-start mb-8 pb-6 border-b border-white/10">
                                <div>
                                    <h2 className="text-4xl mb-2 font-bold text-white">{token?.payload?.preferred_username}</h2>
                                    <p className="text-sm text-white/60">Member since {formatDate(user?.sign_up_date)}</p>
                                </div>

                                {/* Settings buttons container */}
                                <div className="flex flex-wrap gap-3">
                                    {/* Manage Membership Button */}
                                    <button
                                        onClick={handleManageMembership}
                                        className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm text-[#ff6b35] bg-buttonPrivacy border border-[#ff6b354d] cursor-pointer transition-all duration-200 ease-in-out
                                            hover:bg-[rgba(255,107,53,0.25)] hover:-translate-y-[1px]"
                                    >
                                        <CreditCard size={20} color="#ff6b35" />
                                        Manage Membership
                                    </button>

                                    {/* Privacy Settings Button */}
                                    <Dialog.Root open={privacyDialogOpen} onOpenChange={setPrivacyDialogOpen}>
                                        <Dialog.Trigger>
                                            <button
                                                className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm text-[#ff6b35] bg-buttonPrivacy border border-[#ff6b354d] cursor-pointer transition-all duration-200 ease-in-out
                                                    hover:bg-[rgba(255,107,53,0.25)] hover:-translate-y-[1px]"
                                            >
                                                <Settings size={20} color="#ff6b35" />
                                                Privacy Settings
                                            </button>
                                        </Dialog.Trigger>
                                        <Dialog.Content>
                                            <Dialog.Title>Privacy Settings</Dialog.Title>
                                            <Flex align="center" style={{ paddingBottom: '1rem' }}>
                                                <a
                                                    className='terms'
                                                    href="https://app.getterms.io/view/RRt2r/privacy/en-us"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: 'blue', textDecoration: 'underline', cursor: 'pointer' }}
                                                >
                                                    Privacy Policy
                                                </a>
                                            </Flex>
                                            <Dialog.Description mb="4">
                                                <Flex align="center" gap="2">
                                                    Allow filmassistant.io to use your User Generated Content for commercial or development use?:{' '}
                                                    <Text weight="bold">Disallowed</Text>
                                                    <Tooltip
                                                        content="Privacy Settings are set to reflect that filmassistant.io retains no license to use User Generated Content for any commerical or development purposes that are not explicitly consented to by the user. For any questions or concerns, please reach out to accountservices@filmassistant.io"
                                                        side="right"
                                                        style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
                                                    >
                                                        <div style={{ cursor: 'help', display: 'inline-flex' }}>
                                                            <svg
                                                                width="15"
                                                                height="15"
                                                                viewBox="0 0 15 15"
                                                                fill="none"
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                style={{ color: '#666' }}
                                                            >
                                                                <path
                                                                    d="M7.5 1.75C4.26472 1.75 1.75 4.26472 1.75 7.5C1.75 10.7353 4.26472 13.25 7.5 13.25C10.7353 13.25 13.25 10.7353 13.25 7.5C13.25 4.26472 10.7353 1.75 7.5 1.75ZM0.25 7.5C0.25 3.43629 3.43629 0.25 7.5 0.25C11.5637 0.25 14.75 3.43629 14.75 7.5C14.75 11.5637 11.5637 14.75 7.5 14.75C3.43629 14.75 0.25 11.5637 0.25 7.5Z M7 4.75C7 4.33579 7.33579 4 7.75 4C8.16421 4 8.5 4.33579 8.5 4.75C8.5 5.16421 8.16421 5.5 7.75 5.5C7.33579 5.5 7 5.16421 7 4.75ZM7 6.5C7 6.22386 7.22386 6 7.5 6C7.77614 6 8 6.22386 8 6.5V10.5C8 10.7761 7.77614 11 7.5 11C7.22386 11 7 10.7761 7 10.5V6.5Z"
                                                                    fill="currentColor"
                                                                    fillRule="evenodd"
                                                                    clipRule="evenodd"
                                                                />
                                                            </svg>
                                                        </div>
                                                    </Tooltip>
                                                </Flex>
                                            </Dialog.Description>
                                            <Flex direction="column" gap="4">
                                                <Flex gap="2" align="start">
                                                    <label style={{ color: '#666', pointerEvents: 'none' }}>
                                                        <input
                                                            type="radio"
                                                            name="privacyOption"
                                                            value="yes"
                                                            checked={false}
                                                            readOnly
                                                            disabled
                                                            style={{ cursor: 'not-allowed', opacity: 0.5 }}
                                                        />{' '}
                                                        Yes
                                                    </label>
                                                    <label style={{ pointerEvents: 'none' }}>
                                                        <input
                                                            type="radio"
                                                            name="privacyOption"
                                                            value="no"
                                                            checked={true}
                                                            readOnly
                                                            disabled
                                                            style={{ cursor: 'not-allowed' }}
                                                        />{' '}
                                                        No
                                                    </label>
                                                </Flex>
                                            </Flex>
                                            <Flex gap="3" mt="4" justify="end">
                                                <Dialog.Close>
                                                    <Button variant="soft">Close</Button>
                                                </Dialog.Close>
                                            </Flex>
                                        </Dialog.Content>
                                    </Dialog.Root>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-[900px] mx-auto">
                                <UserInfoItem label="Email" value={token?.payload?.email} valueClassName="text-sm font-semibold text-white" />
                                <UserInfoItem label="Tokens" value={user?.cap} valueClassName="text-xl font-semibold text-orange" />
                                <UserInfoItem label="Subscription" value={user?.subscription} valueClassName="inline-block bg-[rgba(34,197,94,0.2)] text-[#22c55e] px-3 py-1 rounded-[12px] text-sm font-medium" />
                                <UserInfoItem label="Sign Up Date" value={user?.sign_up_date} valueClassName="text-sm font-semibold text-white" />
                            </div>
                        </div>

                        <div className="w-full bg-[rgba(255,255,255,0.05)] border-[2px] border-orangeBorder rounded-[16px] p-8 backdrop-blur-[10px]">
                            <div className="border-b border-white/10 mb-8 pb-4">
                                <h3 className="text-2xl text-white font-bold">My Stories</h3>
                            </div>

                            <StoryGrid
                                works={user?.works}
                                loading={loading}
                                onDeleteStory={handleDeleteStory}
                                onNavigateStory={loadWork}
                            />
                        </div>
                    </div>
                </div>

                <Footer />
            </div>
        </Theme>

    );
}