type CommentEvent =
  | { type: 'commentAdded'; videoId: string }
  | { type: 'commentModalClosed'; videoId: string };

type CommentEventListener = (event: CommentEvent) => void;

const listeners = new Set<CommentEventListener>();

export const subscribeToCommentEvents = (listener: CommentEventListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const emitCommentEvent = (event: CommentEvent) => {
  listeners.forEach((listener) => {
    listener(event);
  });
};
