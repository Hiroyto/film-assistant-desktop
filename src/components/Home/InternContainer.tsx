import React, { useState, useContext, useEffect, useRef } from 'react';
import { Box, Flex, Text, Button } from '@radix-ui/themes';
import TextArea from '../TextArea';
import { UserContext } from '../../App';
import { useMutation } from "react-query";
import axios from 'axios';
import { User } from '../../models/user';

// Define the structure of our story data
interface StoryData {
  M: string;
  T: string;
  G: string;
  CQ: string;
  SUM: string;
  S1: string;
  S2: string;
  S3: string;
  S4: string;
  S5: string;
  S6: string;
  S7: string;
  S8: string;
  S9: string;
  [key: string]: string;
}

interface InternContainerProps {
  isVisible: boolean;
  storyData: StoryData;
  onStoryUpdate: (newData: StoryData) => void;
  onDeselectAll?: () => void;
  onSelectAll?: () => void;
  selectedFields: Set<string>;
  mainContentRef: React.RefObject<HTMLElement>;
}

// Icon components for UI elements
const DeselectIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
  </svg>
);

const SelectIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
  </svg>
);

const InternContainer: React.FC<InternContainerProps> = ({ 
  isVisible, 
  storyData,
  onStoryUpdate,
  onDeselectAll,
  onSelectAll,
  selectedFields,
  mainContentRef
}) => {
  const {attributes, user, setUser, signOut, token, loading, data, setData, debouncedSave} = useContext(UserContext);
  const [internInput, setInternInput] = useState('');
  const [internOutput, setInternOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Define all possible fields
  const allFields = ['G', 'T', 'M', 'CQ', 'SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

  // Helper function to get non-empty fields
  const getNonEmptyFields = (): string[] => {
    return allFields.filter(field => storyData[field]?.trim().length > 0);
  };

  // Handle scrolling behavior for the floating container
  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current && mainContentRef.current) {
        const mainRect = mainContentRef.current.getBoundingClientRect();
        const containerHeight = containerRef.current.offsetHeight;
        
        // Calculate boundaries
        const topBoundary = mainRect.top + window.scrollY;
        const bottomBoundary = mainRect.bottom + window.scrollY - containerHeight;
        
        // Calculate new position with buffer
        const buffer = 20;
        let newPosition = window.scrollY - topBoundary + buffer;
        
        // Clamp position
        newPosition = Math.max(0, Math.min(newPosition, bottomBoundary - topBoundary));
        
        // Update position with smooth transition
        setPosition(newPosition);
      }
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);
    handleScroll(); // Initial position

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [mainContentRef]);

  // Handle the intern API mutation
  const mutateIntern = useMutation({
    mutationFn: async () => {
      // Check if all non-empty fields are selected
      const nonEmptyFields = getNonEmptyFields();
      const isAllFieldsSelected = nonEmptyFields.every(field => selectedFields.has(field));
      
      return await axios.post(`${process.env.REACT_APP_URL}/summary`, {
        "event": 'intern',
        "userId": token?.payload['cognito:username'],
        "internInput": internInput,
        "selectedFields": Array.from(selectedFields),
        "isAllFieldsSelected": isAllFieldsSelected,
        ...storyData,
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any) => {
      if (res.data.statusCode == 200) {
        setUser((user: User) => ({...user, cap: res.data.body.cap}));
        const { story, comments } = res.data.body;    
        if (story && Object.keys(story).length > 0) {
          // Only update the fields that were selected
          const updatedData = { ...storyData };
          Object.entries(story).forEach(([key, value]) => {
            if (selectedFields.has(key)) {
              updatedData[key] = value as string;
            }
          });
          onStoryUpdate(updatedData);
        }
        setInternOutput(comments || 'No comments from intern.')
        setIsLoading(false);
      } else if (res.data.statusCode == 400) {
        setInternOutput(res.data.body.error);
        setIsLoading(false);
      } else {
        setInternOutput("error");
        setIsLoading(false);
      }
    },
    onError: (error: any) => {
      setInternOutput('Error processing request. Please try again.');
      setIsLoading(false);
    },
  });

  // Handle the intern submission
  const handleIntern = async () => {
    if (!internInput.trim()) return;
    setIsLoading(true);
    mutateIntern.mutateAsync();
  };

  // Early return if not visible
  if (!isVisible) return null;

  // Calculate if all non-empty fields are selected
  const nonEmptyFields = getNonEmptyFields();
  const allNonEmptyFieldsSelected = nonEmptyFields.length > 0 && 
    nonEmptyFields.every(field => selectedFields.has(field));

  return (
    <Box
      ref={containerRef}
      style={{
        position: 'absolute',
        top: `${position}px`,
        width: '100%',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: '1.5rem',
        padding: '2rem',
        backdropFilter: 'blur(0.625rem)',
        boxShadow: '0 0.75rem 1.5rem rgba(0, 0, 0, 0.2)',
        border: '0.0625rem solid rgba(255, 255, 255, 0.3)',
        transition: 'top 0.1s ease-out',
        maxHeight: '90vh',
        overflowY: 'auto',
        zIndex: 10,
      }}
    >
      <Flex direction="column" gap="1rem">
        <Flex align="center" justify="between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Text size="5" weight="bold">Intern Assistant</Text>
          <Flex gap="2">
            <Button 
              onClick={onSelectAll}
              variant="soft"
              style={{
                backgroundColor: 'rgba(255, 140, 0, 0.1)',
                color: '#FF8C00',
                transition: 'all 0.3s ease',
                padding: '0.5rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <SelectIcon />
              Select All
            </Button>
            <Button 
              onClick={onDeselectAll}
              variant="soft"
              style={{
                backgroundColor: 'rgba(255, 140, 0, 0.1)',
                color: '#FF8C00',
                transition: 'all 0.3s ease',
                padding: '0.5rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <DeselectIcon />
              Deselect All
            </Button>
          </Flex>
        </Flex>

        <Text size="2" style={{ color: 'rgba(0, 0, 0, 0.6)' }}>
          {selectedFields.size === 0 ? (
            'No fields selected. Select fields to modify them.'
          ) : allNonEmptyFieldsSelected ? (
            'All fields selected. Changes will apply to the entire story.'
          ) : (
            'Some fields are selected. Changes will be applied to selected fields.'
          )}
        </Text>

        <TextArea
          field="Your Notes"
          rows={4}
          value={internInput}
          onChange={(e) => setInternInput(e.target.value)}
          onClearField={() => setInternInput('')}
          customLabels={{}}
          isInternField={true}
          isHighlightable={false}
          isDisabled={false}
          tooltipSide="right"
        />
        <Button 
          onClick={handleIntern}
          disabled={isLoading || !internInput.trim() || selectedFields.size === 0}
          style={{
            backgroundColor: 'rgba(255, 140, 0, 0.8)',
            color: 'white',
            transition: 'all 0.3s ease',
            opacity: (!internInput.trim() || isLoading || selectedFields.size === 0) ? 0.5 : 1,
          }}
        >
          {isLoading ? 'Processing...' : 
           selectedFields.size === 0 ? 'Select fields to proceed' : 
           'Submit Request'}
        </Button>
        <Box
          style={{
            backgroundColor: 'white',
            borderRadius: '1rem',
            padding: '1rem',
            minHeight: '12.5rem',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          <Text>{internOutput || "Intern Reponse will appear here"}</Text>
        </Box>
      </Flex>
    </Box>
  );
};

export default InternContainer;