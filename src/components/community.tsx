import React from 'react';
import { Amplify } from 'aws-amplify';
import Header from './header';
import Footer from './footer';  
import { useState, useContext } from "react";
import { FetchUserAttributesOutput } from 'aws-amplify/auth';
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Theme, Flex, Text, Button, Grid, Box, ScrollArea, Dialog } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { useMutation } from "react-query";
import axios from 'axios';
import { TailSpin } from 'react-loading-icons';
import { toast, Toaster } from 'react-hot-toast';

import config from '../aws-exports';
import { UserContext } from '../App';
import { User } from '../models/user';
import { Event, EventStatus } from '../models/event';
import whiteOverlay from './Head-color with text.png';
import './community.css';

Amplify.configure(config);

export function Community(props: any) {
  const { token, loading, events, setEvents, user, setUser } = useContext(UserContext);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const isMember = user?.subscription === 'member';

  const mutateSubmitWork = useMutation({
    mutationFn: (workKey: string) => {
      return axios.post(`${process.env.REACT_APP_URL}/community`, {
        "userId": token?.payload['cognito:username'],
        "username": token?.payload?.preferred_username,
        "email": token?.payload?.email,
        "event": "submit",
        "title": workKey,
        "story": user?.works ? user.works[workKey as keyof typeof user.works] : null,
        "eventId": events[0].id
      },
      { headers: { "Authorization": token?.toString()} }
      );
    },
    onSuccess: (res: any) => {
      if (res.data.statusCode === 200) {
        toast.success("Story Submitted!", {
          duration: 3000,
          position: 'top-center',
          className: 'custom-toast success-toast',
          style: {
            marginTop: '45vh',
          },
          icon: '✅',
          
        });

        setDialogOpen(false);
        setUser((u: User) => ({
          ...u, 
          contest_submitted: true,
        }));
      } else if (res.data.statusCode === 400) {
        console.log(res.data.body.error);
        toast.error(res.data.body.error, {
          className: 'custom-toast error-toast',
          style: {
            marginTop: '45vh',
          },
        });
      } else {
        toast.error("Error submitting story", {
          className: 'custom-toast error-toast',
          style: {
            marginTop: '45vh',
          },
        });
      }
    },
    onError: (error: any) => {
      toast.error("Error submitting story", {
        className: 'custom-toast error-toast',
        style: {
          marginTop: '45vh',
        },
      });
    },
  });

  const handleSubmitWork = (workKey: string) => {
    mutateSubmitWork.mutateAsync(workKey);
  };

  if (!loading) {
    return (
      <div className="loading-container">
        <TailSpin stroke="#FFA500" speed={1.3} />
      </div>
    );
  }

  return (
    <Theme>
      <Toaster 
        position="top-center"
        reverseOrder={false}
        containerStyle={{
          top: 0,
          inset: '0px'
        }}
      />
      <div className="app-container" style={{ paddingBottom: '3rem' }}>
        <div className="gradient-background" />
        <Header />
        
        <Flex direction="column" justify="center" align="center" style={{ flexGrow: 1, position: 'relative' }}>
          <h1 className="page-header">Community</h1>
          
          <Flex direction="row" justify="center" align="center">
            <ScrollArea 
              type="hover" 
              scrollbars="vertical" 
              className="scroll-area"
            >
              <Flex direction="column" justify="center" align="center">
                {events.map((event: Event) => (
                  <Box key={event.id} className="event-container">
                    {event.status === EventStatus.OPEN ? (
                      <>
                        <Text className="event-title" size="6" weight="bold">
                        {event.title}
                        </Text>
                        <Flex direction="column" gap="2" align="center">
                          <Text className="event-prize" size="5">
                            ${event.prize} Prize
                          </Text>
                          <Text className="event-date" size="3">
                            Due {new Date(event.date).toLocaleDateString()}
                          </Text>
                        </Flex>

                        <Flex justify="center" align="center" style={{ marginTop: '2rem' }}>
                          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
                            <Dialog.Trigger>
                              <Button 
                                size="3"
                                variant="solid"
                                disabled={!isMember || user?.contest_submitted}
                                style={{
                                  backgroundColor: isMember && !user?.contest_submitted ? '#FF8C00' : '#cccccc',
                                  color: 'white',
                                  padding: '0.75rem 1.5rem',
                                  borderRadius: '0.5rem',
                                  cursor: isMember ? 'pointer' : 'not-allowed',
                                  width: '200px'
                                }}
                              >
                                {!isMember ? 'Membership Required' : user?.contest_submitted ? 'Story Submitted' : 'Submit Story'}
                              </Button>
                            </Dialog.Trigger>

                            <Dialog.Content className="submit-dialog">
                              <Dialog.Title className="dialog-title">
                                Submit Story
                              </Dialog.Title>
                              <Flex direction="column" gap="3">
                                <label style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                                  <input
                                    type="checkbox"
                                    checked={consentGiven}
                                    onChange={(e) => setConsentGiven(e.target.checked)}
                                  />
                                  <Text size="2" style={{textAlign: 'center'}}>
                                    I consent to share my username and submission publicly
                                  </Text>
                                </label>
                                <Grid columns="2" gap="4" className="work-grid">
                                  {user?.works && Object.keys(user.works).map(key => (
                                    <Box key={key} className="work-box">
                                      <Text className="work-title">{key}</Text>                          
                                      <Dialog.Root>
                                        <Dialog.Trigger>
                                          <Button 
                                            className="submit-work-button"
                                            disabled={!consentGiven}
                                            style={{
                                              cursor: consentGiven ? 'pointer' : 'not-allowed',
                                              opacity: consentGiven ? 1 : 0.6
                                            }}
                                          >
                                            Submit
                                          </Button>
                                        </Dialog.Trigger>
                                        <Dialog.Content 
                                          style={{
                                            height: '15rem',
                                            width: '20rem'
                                          }}
                                        >
                                          <Dialog.Title style={{textAlign: 'center'}}>
                                            Are you sure you want to submit this story?
                                          </Dialog.Title>                                        
                                          <Dialog.Description size="2" mb="4">
                                            
                                          </Dialog.Description>
                                          
                                          <Flex 
                                            gap="3" 
                                            mt="4" 
                                            justify="between"
                                            style={{
                                              position: 'absolute',
                                              bottom: 20,
                                              left: 20,
                                              right: 20
                                            }}
                                          >
                                            <Dialog.Close>
                                              <Button 
                                                className="submit-work-button"
                                                onClick={() => handleSubmitWork(key)}
                                              >
                                                Submit
                                              </Button>
                                            </Dialog.Close>
                                            <Dialog.Close>
                                              <Button className="submit-work-button">
                                                Cancel                                                
                                              </Button>
                                            </Dialog.Close>
                                          </Flex>
                                        </Dialog.Content>
                                      </Dialog.Root>
                                    </Box>
                                  ))}
                                </Grid>

                                <Flex gap="3" justify="end">
                                  <Dialog.Close>
                                    <Button variant="soft" className="close-button">
                                      Close
                                    </Button>
                                  </Dialog.Close>
                                </Flex>
                              </Flex>
                            </Dialog.Content>
                          </Dialog.Root>
                        </Flex>
                      </>
                    ) : (
                      <>
                        <Text className="event-title" size="6" weight="bold">
                          {event.title}
                        </Text>
                        <Text className="event-date" size="3">
                          {new Date(event.date).toLocaleDateString()}
                        </Text>
                        <Text className="winner-name">
                          Winner: {event.winner?.username}
                        </Text>

                        <Dialog.Root>
                          <Dialog.Trigger>
                            <Button 
                              size="3"
                              variant="solid"
                              disabled={!isMember}
                              style={{
                                backgroundColor: isMember ? '#FF8C00' : '#cccccc',
                                color: 'white',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '0.5rem',
                                cursor: isMember ? 'pointer' : 'not-allowed',
                                width: '200px'
                              }}
                            >
                              {!isMember ? 'Membership Required' : 'View Story'}
                            </Button>
                          </Dialog.Trigger>

                          <Dialog.Content className="story-dialog">
                            <Dialog.Title className="dialog-title">
                              {event.winner?.title}
                            </Dialog.Title>

                            <Box className="story-content">
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                                const key = `S${num}` as keyof typeof event.winner.story;
                                return (
                                  event?.winner?.story?.[key] && (
                                    <React.Fragment key={num}>
                                      {event.winner.story[key]}
                                      <br /><br />
                                    </React.Fragment>
                                  )
                                );
                              })}
                            </Box>

                            <Flex gap="3" justify="end">
                              <Dialog.Close>
                                <Button variant="soft" className="close-button">
                                  Close
                                </Button>
                              </Dialog.Close>
                            </Flex>
                          </Dialog.Content>
                        </Dialog.Root>
                      </>
                    )}
                  </Box>
                ))}
              </Flex>
            </ScrollArea>
          </Flex>
        </Flex>
      </div>
      <Footer />
    </Theme>
  );
}

export default Community;


//onClick={() => handleSubmitWork(key)}