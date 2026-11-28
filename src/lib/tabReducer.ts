export interface TabState<T extends string> {
  tab: T;
  /** Slide direction of the last switch: 1 forward, -1 backward. */
  direction: number;
}

/** Without `order` the tab is replaced and the slide direction is kept. */
export function tabReducer<T extends string>(
  state: TabState<T>,
  { to, order }: { to: T; order?: Record<T, number> },
): TabState<T> {
  if (to === state.tab) return state;
  const direction = order ? (order[to] > order[state.tab] ? 1 : -1) : state.direction;
  return { tab: to, direction };
}
