export interface StudyRoomCheckin {
  date: string;
  hours: number;
  mood?: string;
}

export interface StudyRoomPlan {
  id: string;
  name: string;
  goal: string;
  tasks: { id: string; title: string; done: boolean }[];
  createdAt: string;
}

export interface StudyRoomDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface StudyRoomTodo {
  id: string;
  title: string;
  completed: boolean;
}

export interface StudyRoomFocusSession {
  minutes: number;
  sessionId: string;
  createdAt: string;
}

export interface StudyRoomState {
  checkins: StudyRoomCheckin[];
  plans: StudyRoomPlan[];
  docs: StudyRoomDoc[];
  todos: StudyRoomTodo[];
  focus_sessions: StudyRoomFocusSession[];
}
