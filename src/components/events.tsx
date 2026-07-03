import React from 'react';
import { Amplify } from 'aws-amplify';
import Header from './header';
import Footer from './footer';  
import {useDropzone} from 'react-dropzone';
import { useState , useEffect, useContext} from "react";
import {useForm} from "react-hook-form";
import { fetchUserAttributes } from 'aws-amplify/auth';
import { FetchUserAttributesOutput } from 'aws-amplify/auth';
import {updateUserAttribute,type UpdateUserAttributeOutput} from 'aws-amplify/auth';
import { getCurrentUser } from 'aws-amplify/auth';
import { useMutation } from "react-query";
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import config from '../aws-exports';
import { Theme, Flex, Text, Button, Grid, TextArea ,TextField,Box, Checkbox, ScrollArea,Dialog,Table,DropdownMenu} from '@radix-ui/themes';
import axios from 'axios';
import '@radix-ui/themes/styles.css';
import { DataList,Badge, } from '@radix-ui/themes';
import { ComponentPlaceholderIcon } from '@radix-ui/react-icons';
import { TailSpin } from 'react-loading-icons';
import {UserContext} from '../App';
import whiteOverlay from './Head-color with text.png';
import {toast,Toaster } from 'react-hot-toast';
import { User } from '../models/user';
import { Trash } from 'lucide-react';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import './profile.css';
import { Event, EventStatus, Winner, Submission } from '../models/event';
import { couldStartTrivia } from 'typescript';



Amplify.configure(config);


export function Events(props:any) {
  
  const {user, setUser, signOut, token, loading, data, setData,debouncedSave,events,setEvents,submissions,setSubmissions} = useContext(UserContext);
  const[changeUsername,setChangeUsername] = useState("");
  const[file, setFile] = useState<File | undefined>();
  const[preview, setPreview] = useState<string| ArrayBuffer | null>();
  const [set, setSet] = useState(new Set<string>());
  const [deletingItems, setDeletingItems] = useState(new Set<string>());
  const isDeleteSelectedDisabled = set.size === 0 || deletingItems.size > 0;
  const [hoveredStates, setHoveredStates] = useState<{[key: string]: boolean}>({});
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState(new Date());
  const [eventPrize, setEventPrize] = useState(0);
  const [eventSubmissions, setEventSubmissions] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const getEventRowStyle = (eventId: string) => {
    const event = events.find((e: Event) => e.id === eventId);
    return {
      backgroundColor: event?.status === EventStatus.CLOSED ? '#E0E0E0' : 
                       event?.status === EventStatus.WINNER ? '#4CAF50' : undefined,
      color: (event?.status === EventStatus.CLOSED || event?.status === EventStatus.WINNER) ? '#FFFFFF' : undefined,
      cursor: 'pointer',
      transition: 'all 0.2s ease-in-out',
      boxShadow: selectedEvent === eventId ? '0 0 10px rgba(255, 165, 0, 0.5)' : 'none'
    };
  };

  const handleEventClick = ( eventId: string, event: React.MouseEvent) => {
    const isDropdownClick = (event.target as HTMLElement).closest('[role="menuitem"]') || 
                           (event.target as HTMLElement).closest('button');
    
    if (!isDropdownClick) {
      setSelectedEvent(eventId === selectedEvent ? null : eventId);
    }
  };

  const handleCreateEvent = () => {
    
    if (!eventTitle || !eventDate || !eventPrize) {
      toast.error('Please fill in all fields');
      return;
    }
    const newEvent: Event = {
      id: crypto.randomUUID(),
      type: "EVENT",
      title: eventTitle,
      date: eventDate.toISOString(),
      prize: eventPrize,
      status: EventStatus.OPEN,
      submissions: 0,
      createdAt: new Date().toISOString(),
      winner: {} as Winner
    };

    mutateCreateEvent.mutateAsync(newEvent);
  };

  const mutateCreateEvent = useMutation({
    mutationFn:(newEvent: Event) => {

      return axios.post(`${process.env.REACT_APP_URL}/events`, {
        "userId": token?.payload['cognito:username'],
        "event": "create",
        "object": newEvent
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any, newEvent: Event) => {
      if (res.data.statusCode == 200) {
        toast.success("Event created successfully!");
        setEvents((events: Event[]) => [...events, newEvent].sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ));
      } else if (res.data.statusCode == 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
    },
  });

  
  
  const handleEndEvent = (eventId: string) => {

  
    mutateEndEvent.mutateAsync(eventId);

  };

  const mutateEndEvent = useMutation({
    mutationFn:(eventId: string) => {

      return axios.post(`${process.env.REACT_APP_URL}/events`, {
        "userId": token?.payload['cognito:username'],
        "event": "end",
        "id": eventId
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any, eventId: string) => {
      if (res.data.statusCode == 200) {
        toast.success("Event Ended!");
        setEvents((events: Event[]) => events.map(event => 
          event.id === eventId ? res.data.body.updatedEvent : event
        ));
      } else if (res.data.statusCode == 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
    },
  });

  const handleDeleteEvent = (eventId: string) => {
  
    mutateDeleteEvent.mutateAsync(eventId);

  };

  const mutateDeleteEvent = useMutation({
    mutationFn: (eventId: string) => {
      return axios.post(`${process.env.REACT_APP_URL}/events`, {
        "userId": token?.payload['cognito:username'],
        "event": "delete",
        "id": eventId
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any, eventId: string) => {
      if (res.data.statusCode == 200) {
        toast.success("Event Deleted!");
        setEvents((events: Event[]) => events
          .filter(event => event.id !== eventId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        );
      } else if (res.data.statusCode == 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
    },
  });

  const handleDeclareWinner = (event: Event, submission: Submission) => {   
    const newWinner: Winner = {
      username: submission.username,
      email: submission.email,
      title: submission.title,
      prize: event.prize,
      story: submission.story
    };
    mutateDeclareWinner.mutateAsync({
      eventId: event.id,
      winner: newWinner
    });
  };

  const mutateDeclareWinner = useMutation({
    mutationFn: (params: { eventId: string, winner: Winner }) => {
      return axios.post(`${process.env.REACT_APP_URL}/events`, {
        "userId": token?.payload['cognito:username'],
        "event": "winner",
        "id": params.eventId,
        "winner": params.winner
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any, params: { eventId: string, winner: Winner }) => {
      if (res.data.statusCode == 200) {
        toast.success("Winner chosen !");
        setEvents((events: Event[]) => events.map(event => 
          event.id === params.eventId ? res.data.body.event : event
        ));
        setSelectedEvent(null);
      } else if (res.data.statusCode == 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
    },
  });

  if (loading == false) {
    return (
      <>
        <div
        style={{
          position: 'relative',
          left:'50%',
          top:'18.75rem',
        }}   
        >
      <TailSpin  stroke="#FFA500" speed="1.3" />
        </div>
      </>
    );
  } else {
    return (
      <>
        <Theme>
        <Toaster
          position="top-center"
          reverseOrder={false}
        />
          <div className="app-container" style={{ paddingBottom: '3rem' }}>
          <div className="gradient-background"></div>
            <Header/>
            <Flex direction="column" justify="center" align="center" style={{ flexGrow: 1, position: 'relative' }}>
            <Flex direction="row" position="relative" left="15rem">
                <Dialog.Root>
                <Dialog.Trigger>    
                    <Button 
                      variant="solid" 
                      size="2" 
                      disabled={selectedEvent !== null}
                    >
                      Create Event
                    </Button>
                </Dialog.Trigger>
                <Dialog.Content style={{ height: '50rem', width: '50rem', position: 'relative' }}>
                    <Dialog.Title>Create Event</Dialog.Title>
                    <Flex direction="column" gap="3">
                      <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                          Event Title
                        </Text>
                        <TextField.Root
                          placeholder="Enter a title"
                          value={eventTitle}
                          onChange={(e) => setEventTitle(e.target.value)}
                        />
                      </label>
                      <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                          Event Date
                        </Text>
                        <DatePicker className="date-picker" selected={eventDate} onChange={(date:Date | null) => setEventDate(date ?? new Date())} />
                    </label>
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                          Event Prize
                        </Text>
                        <TextField.Root
                          placeholder="Enter a prize"
                          value={eventPrize}
                          onChange={(e) => setEventPrize(Number(e.target.value))}
                        />
                    </label>                         
                    </Flex>
                    <Flex 
                      direction="row" 
                      justify="between" 
                      gap="2"
                      style={{
                        position: 'absolute',
                        bottom: '20px',
                        left: '20px',
                        right: '20px',
                        width: 'calc(100% - 40px)'
                      }}
                    >
                      <Dialog.Close>
                        <Button variant="soft">
                          Cancel
                        </Button>
                      </Dialog.Close>
                      <Dialog.Close>
                        <Button variant="solid" onClick={handleCreateEvent}>
                          Create
                        </Button>
                      </Dialog.Close>
                    </Flex>
                  </Dialog.Content>
                </Dialog.Root>
            </Flex>
            <Flex direction="row" justify="center" align="center" > 
                <ScrollArea type="hover" scrollbars="vertical" style={{ 
                            height:'50rem', 
                            width:'40rem', 
                            backgroundColor: 'rgba(255, 255, 255, 0.2)',
                            borderRadius: '1.5rem',
                            padding: '2rem',
                            paddingTop: '2.5rem',
                            backdropFilter: 'blur(0.625rem)',
                            boxShadow: '0 0.75rem 1.5rem rgba(0, 0, 0, 0.2)',
                            border: '0.0625rem solid rgba(255, 255, 255, 0.3)',
                            margin: '1.5625rem 0',
                            zIndex: 2,}}>
                <div id="events" style={{ display: selectedEvent ? 'none' : 'block' }}>
                  <Table.Root variant="surface">
                      <Table.Header>
                          <Table.Row>
                              <Table.ColumnHeaderCell>Event Name</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Prize</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Submissions</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
                          </Table.Row>
                      </Table.Header>
                      <Table.Body>
                          {events && events.map((event: Event) => (
                              <Table.Row 
                                  key={event.id} 
                                  style={getEventRowStyle(event.id)}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.boxShadow = '0 0 10px rgba(255, 165, 0, 1)';
                                    e.currentTarget.style.transform = 'scale(1.01)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.boxShadow = selectedEvent === event.id ? '0 0 10px rgba(255, 165, 0, 0.5)' : 'none';
                                    e.currentTarget.style.transform = 'scale(1)';
                                  }}
                                  onClick={(e) => handleEventClick(event.id, e)}
                              >
                                  <Table.RowHeaderCell>{event.title}</Table.RowHeaderCell>
                                  <Table.Cell>{new Date(event.date).toLocaleDateString()}</Table.Cell>
                                  <Table.Cell>${event.prize}</Table.Cell>
                                  <Table.Cell>{event.submissions}</Table.Cell>
                                  <Table.Cell>
                                      <DropdownMenu.Root>
                                          <DropdownMenu.Trigger>
                                              <Button variant="solid" size="1">
                                                  Options
                                                  <DropdownMenu.TriggerIcon />
                                              </Button>
                                          </DropdownMenu.Trigger>
                                          <DropdownMenu.Content>
                                          <DropdownMenu.Item                               
                                              disabled={event.status === EventStatus.CLOSED || event.status === EventStatus.WINNER}
                                              onSelect={(event) =>{event.preventDefault();}}
                                          >
                                            <Dialog.Root>
                                              <Dialog.Trigger>
                                                <Button 
                                                  variant="ghost" 
                                                  style={{ 
                                                    width: '100%', 
                                                    textAlign: 'left',
                                                    padding: 0,
                                                    margin: 0,
                                                    height: 'auto',
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'inherit',
                                                    fontSize: 'inherit',
                                                    cursor: 'inherit'
                                                  }}
                                                >
                                              End Event
                                              </Button>
                                        </Dialog.Trigger>
                                        <Dialog.Content 
                                          style={{
                                            height: '15rem',
                                            width: '20rem'
                                          }}>
                                          <Dialog.Title style={{textAlign: 'center'}}>Are you sure you want to end this event?</Dialog.Title>                                    
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
                                              <Button variant="soft"
                                              onClick={() => handleEndEvent(event.id)}
                                              >
                                                End Event
                                               
                                              </Button>
                                            </Dialog.Close>
                                            <Dialog.Close>
                                              <Button variant="soft">
                                                Close
                                              </Button>
                                            </Dialog.Close>
                                          </Flex>
                                        </Dialog.Content>
                                      </Dialog.Root>
                                          </DropdownMenu.Item>
                                          <DropdownMenu.Item onClick={() => handleDeleteEvent(event.id)} color="red">Delete</DropdownMenu.Item>
                                          </DropdownMenu.Content>
                                      </DropdownMenu.Root>
                                  </Table.Cell>
                              </Table.Row>
                          ))}
                      </Table.Body>
                  </Table.Root>
                </div>
                {selectedEvent && (
                  <div id="users">
                    <Flex justify="start" mb="4">
                      <Button 
                        variant="soft" 
                        onClick={() => setSelectedEvent(null)}
                      >
                        ← Back to Events
                      </Button>
                    </Flex>

                    {(selectedEvent === events[0]?.id && 
                      (events[0]?.status === EventStatus.OPEN || events[0]?.status === EventStatus.CLOSED)) ? (
                      <Table.Root variant="surface">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeaderCell>Username</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>
                            </Table.ColumnHeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {submissions && submissions.map((submission: Submission) => (
                            <Table.Row key={submission.userId}>
                              <Table.RowHeaderCell>{submission.username}</Table.RowHeaderCell>
                              <Table.Cell>{submission.email}</Table.Cell>
                              <Table.Cell>{submission.title}</Table.Cell>
                              <Table.Cell>
                                <DropdownMenu.Root>
                                  <DropdownMenu.Trigger>
                                    <Button variant="solid" size="1">
                                      Options
                                      <DropdownMenu.TriggerIcon />
                                    </Button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Content>
                                    <DropdownMenu.Item onSelect={(event) => {   // Prevent the default closing behavior
                                      event.preventDefault();
                                    }}>
                                      <Dialog.Root>
                                        <Dialog.Trigger>
                                          <Button 
                                            variant="ghost" 
                                            style={{ 
                                              width: '100%', 
                                              textAlign: 'left',
                                              padding: 0,
                                              margin: 0,
                                              height: 'auto',
                                              background: 'none',
                                              border: 'none',
                                              color: 'inherit',
                                              fontSize: 'inherit',
                                              cursor: 'inherit'
                                            }}
                                          >
                                            View Story
                                          </Button>
                                        </Dialog.Trigger>
                                        <Dialog.Content 
                                          style={{
                                            height: '50rem',
                                            width: '60rem'
                                          }}>
                                          <Dialog.Title style={{textAlign: 'center'}}>{submission.title}</Dialog.Title>
                                          <Dialog.Description size="2" mb="4">
                                            <ScrollArea type="hover" scrollbars="vertical" style={{ height: '40rem' }}>
                                              <Flex direction="column" gap="3">
                                                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => {
                                                  const key = `S${num}`;
                                                  return (
                                                    submission.story[key] && (
                                                      <Text key={num}>
                                                        {submission.story[key]}
                                                      </Text>
                                                    )
                                                  );
                                                })}
                                              </Flex>
                                            </ScrollArea>
                                          </Dialog.Description>
                                          <Flex gap="3" mt="4" justify="end">
                                            <Dialog.Close>
                                              <Button variant="soft">
                                                Close
                                              </Button>
                                            </Dialog.Close>
                                          </Flex>
                                        </Dialog.Content>
                                      </Dialog.Root>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item 
                                      color="green" 
                                      onClick={() => handleDeclareWinner(events[0], submission)}
                                      disabled={events[0]?.status !== EventStatus.CLOSED}
                                    >
                                      Declare Winner
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </Table.Cell>
                          </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Root>
                    ) : (selectedEvent === events[0]?.id && events[0]?.status === EventStatus.WINNER) ? (
                      <Table.Root variant="surface">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeaderCell>Username</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>
                            </Table.ColumnHeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {events[0]?.winner && (
                            <Table.Row>
                              <Table.RowHeaderCell>{events[0].winner.username}</Table.RowHeaderCell>
                              <Table.Cell>{events[0].winner.email}</Table.Cell>
                              <Table.Cell>{events[0].winner.title}</Table.Cell>
                              <Table.Cell>
                                <DropdownMenu.Root>
                                  <DropdownMenu.Trigger>
                                    <Button variant="solid" size="1">
                                      Options
                                      <DropdownMenu.TriggerIcon />
                                    </Button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Content>
                                    <DropdownMenu.Item onSelect={(event) => {   // Prevent the default closing behavior
                                      event.preventDefault();
                                    }}>
                                      <Dialog.Root>
                                        <Dialog.Trigger>
                                          <Button 
                                            variant="ghost" 
                                            style={{ 
                                              width: '100%', 
                                              textAlign: 'left',
                                              padding: 0,
                                              margin: 0,
                                              height: 'auto',
                                              background: 'none',
                                              border: 'none',
                                              color: 'inherit',
                                              fontSize: 'inherit',
                                              cursor: 'inherit'
                                            }}
                                          >
                                            View Story
                                          </Button>
                                        </Dialog.Trigger>
                                        <Dialog.Content 
                                          style={{
                                            height: '50rem',
                                            width: '60rem'
                                          }}>
                                          <Dialog.Title style={{textAlign: 'center'}}>{events[0].winner.title}</Dialog.Title>
                                          <Dialog.Description size="2" mb="4">
                                            <ScrollArea type="hover" scrollbars="vertical" style={{ height: '40rem' }}>
                                              <Flex direction="column" gap="3">
                                                {events[0].winner.story && ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => {
                                                  const key = `S${num}`;
                                                  return (
                                                    events[0].winner.story[key] && (
                                                      <Text key={num}>
                                                        {events[0].winner.story[key]}
                                                      </Text>
                                                    )
                                                  );
                                                })}
                                              </Flex>
                                            </ScrollArea>
                                          </Dialog.Description>
                                          <Flex gap="3" mt="4" justify="end">
                                            <Dialog.Close>
                                              <Button variant="soft">
                                                Close
                                              </Button>
                                            </Dialog.Close>
                                          </Flex>
                                        </Dialog.Content>
                                      </Dialog.Root>
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Root>
                    ) : (
                      <Table.Root variant="surface">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeaderCell>Username</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>
                            </Table.ColumnHeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {(() => {
                            const winner = events.find((e: Event) => e.id === selectedEvent)?.winner;
                            return winner ? (
                              <Table.Row>
                                <Table.RowHeaderCell>{winner.username}</Table.RowHeaderCell>
                                <Table.Cell>{winner.email}</Table.Cell>
                                <Table.Cell>{winner.title}</Table.Cell>
                                <Table.Cell>
                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger>
                                      <Button variant="solid" size="1">
                                        Options
                                        <DropdownMenu.TriggerIcon />
                                      </Button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content>
                                      <DropdownMenu.Item onSelect={(event) => {   // Prevent the default closing behavior
                                        event.preventDefault();
                                      }}>
                                        <Dialog.Root>
                                          <Dialog.Trigger>
                                            <Button 
                                              variant="ghost" 
                                              style={{ 
                                                width: '100%', 
                                                textAlign: 'left',
                                                padding: 0,
                                                margin: 0,
                                                height: 'auto',
                                                background: 'none',
                                                border: 'none',
                                                color: 'inherit',
                                                fontSize: 'inherit',
                                                cursor: 'inherit'
                                              }}
                                            >
                                              View Story
                                            </Button>
                                          </Dialog.Trigger>
                                          <Dialog.Content 
                                            style={{
                                              height: '50rem',
                                              width: '60rem'
                                            }}>
                                            <Dialog.Title style={{textAlign: 'center'}}>{winner.title}</Dialog.Title>
                                            <Dialog.Description size="2" mb="4">
                                              <ScrollArea type="hover" scrollbars="vertical" style={{ height: '40rem' }}>
                                                <Flex direction="column" gap="3">
                                                  {winner.story && ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => {
                                                    const key = `S${num}`;
                                                    return (
                                                      winner.story[key] && (
                                                        <Text key={num}>
                                                          {winner.story[key]}
                                                        </Text>
                                                      )
                                                    );
                                                  })}
                                                </Flex>
                                              </ScrollArea>
                                            </Dialog.Description>
                                            <Flex gap="3" mt="4" justify="end">
                                              <Dialog.Close>
                                                <Button variant="soft">
                                                  Close
                                                </Button>
                                              </Dialog.Close>
                                            </Flex>
                                          </Dialog.Content>
                                        </Dialog.Root>
                                      </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                  </DropdownMenu.Root>
                                </Table.Cell>
                              </Table.Row>
                            ) : null;
                          })()}
                        </Table.Body>
                      </Table.Root>
                    )}
                  </div>
                )}
                </ScrollArea>
            </Flex>
            </Flex>
            </div>
        <Footer/>
      </Theme>
      </>
    )};
}
export default Events;
//() => handleEndEvent(event.id)