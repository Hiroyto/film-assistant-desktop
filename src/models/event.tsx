export interface Winner {
  username?: string;
  email?: string;
  event?: string;
  prize?: number;
  title?: string;
  story: Record<string, any>;
}

export interface Event {
  id: string;
  type: string;
  title: string;
  date: string;
  prize: number;
  status: string;
  submissions: number;
  createdAt: string;
  winner: Winner;
}

export interface Submission {
  userId: string;
  username: string;
  email: string;
  story: Record<string, any>;
  title: string;

  
}

// Optional: Add type for event status to prevent typos
export enum EventStatus {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
  WINNER = "WINNER"
}

