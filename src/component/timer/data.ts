import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
  ComponentUnique,
} from '../base';
import type { TimerMethods } from './methods';

export interface TimerT
  extends ComponentData, ComponentInstanceMethods<TimerMethods> {
  type: 'timer';
  unique: ComponentUnique.FALSE;

  /** Current elapsed time in milliseconds. */
  time: number;

  /** Speed multiplier for time accumulation. */
  speed: number;

  /** Duration in milliseconds before triggering events. */
  duration: number;

  /**
   * Repeat behavior:
   * - false: fires once then stops
   * - true: repeats forever
   * - number: decrements after each repeat, stops at 0
   */
  repeat: number | boolean;

  /** If true, disposes the timer after it completes fully. */
  destroy: boolean;

  /** Whether the timer is currently running. */
  running: boolean;

  /** Method keys to invoke when the timer fires. */
  events: Set<string>;
}

export interface TimerOptions extends ComponentOptions {
  time?: number;
  speed?: number;
  duration: number;
  repeat?: number | boolean;
  destroy?: boolean;
  events?: string[];
}

export function builder(options: TimerOptions): TimerT {
  const timer = {
    type: 'timer' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    time: options.time ?? 0,
    speed: options.speed ?? 1,
    duration: options.duration,
    repeat: options.repeat ?? false,
    destroy: options.destroy ?? false,
    running: false,
    events: new Set<string>(options.events ?? []),
  };

  return timer as unknown as TimerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const t = component as TimerT;

  return {
    type: 'timer',
    name: t.name,
    time: t.time,
    speed: t.speed,
    duration: t.duration,
    repeat: t.repeat,
    destroy: t.destroy,
    running: false,
    events: Array.from(t.events),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): TimerT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, duration } = data;

  const errors: string[] = [];
  if (type !== 'timer') {
    errors.push(`type ${type} does not match "timer"`);
  }
  if (!name) {
    errors.push('timer requires a name');
  }
  if (duration === undefined || duration === null) {
    errors.push('timer requires a duration');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    time: data.time as number,
    speed: data.speed as number,
    duration: duration as number,
    repeat: data.repeat as number | boolean,
    destroy: data.destroy as boolean,
    events: data.events as string[],
  });
}

export const TimerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'time',
  'speed',
  'duration',
  'repeat',
  'destroy',
  'running',
  'events',
];
