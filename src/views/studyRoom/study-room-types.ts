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
  /** 待办所属日期（本地 YYYY-MM-DD），旧数据可能缺失。 */
  date?: string;
  /** 完成日期（本地 YYYY-MM-DD），用于让顺延任务完成后当天仍然可见。 */
  completedOn?: string;
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
