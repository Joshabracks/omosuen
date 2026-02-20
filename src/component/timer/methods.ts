import { ComponentData, ComponentMethods } from '../types';
import { TimerT } from './data';
import { MethodRegistry } from '../registry';
import { markForDisposal } from '../../loop';

export interface TimerMethods extends ComponentMethods {
  type: 'timer';
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
  dispose: (component: ComponentData) => void;
  setTime: (timer: TimerT, time: number) => void;
  getTime: (timer: TimerT) => number;
  setSpeed: (timer: TimerT, speed: number) => void;
  getSpeed: (timer: TimerT) => number;
  setDuration: (timer: TimerT, duration: number) => void;
  getDuration: (timer: TimerT) => number;
  setRepeat: (timer: TimerT, repeat: number | boolean) => void;
  getRepeat: (timer: TimerT) => number | boolean;
  addEvent: (timer: TimerT, key: string) => void;
  removeEvent: (timer: TimerT, key: string) => void;
  start: (timer: TimerT) => void;
  stop: (timer: TimerT) => void;
  restart: (timer: TimerT) => void;
}

export const Timer: TimerMethods = {
  type: 'timer',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  update(component: ComponentData, deltaTime: number): void {
    const timer = component as TimerT;
    if (!timer.running) return;

    timer.time += deltaTime * timer.speed;

    if (timer.time >= timer.duration) {
      // Fire all registered events
      for (const key of timer.events) {
        const method = MethodRegistry['timer'][key];
        if (method && typeof method === 'function') {
          (method as (t: TimerT) => void)(timer);
        }
      }

      if (timer.repeat === false) {
        // Single shot — stop
        timer.running = false;
        if (timer.destroy) {
          markForDisposal(timer);
        }
      } else if (timer.repeat === true) {
        // Infinite — carry over excess
        timer.time -= timer.duration;
      } else {
        // Numeric countdown
        (timer.repeat as number)--;
        if ((timer.repeat as number) <= 0) {
          timer.running = false;
          timer.repeat = 0;
          if (timer.destroy) {
            markForDisposal(timer);
          }
        } else {
          timer.time -= timer.duration;
        }
      }
    }
  },

  dispose(component: ComponentData): void {
    const timer = component as TimerT;
    timer._disposed = true;
    timer.running = false;
    timer.events.clear();
  },

  setTime(timer: TimerT, time: number): void {
    timer.time = time;
  },

  getTime(timer: TimerT): number {
    return timer.time;
  },

  setSpeed(timer: TimerT, speed: number): void {
    timer.speed = speed;
  },

  getSpeed(timer: TimerT): number {
    return timer.speed;
  },

  setDuration(timer: TimerT, duration: number): void {
    timer.duration = duration;
  },

  getDuration(timer: TimerT): number {
    return timer.duration;
  },

  setRepeat(timer: TimerT, repeat: number | boolean): void {
    timer.repeat = repeat;
  },

  getRepeat(timer: TimerT): number | boolean {
    return timer.repeat;
  },

  addEvent(timer: TimerT, key: string): void {
    timer.events.add(key);
  },

  removeEvent(timer: TimerT, key: string): void {
    timer.events.delete(key);
  },

  start(timer: TimerT): void {
    timer.running = true;
  },

  stop(timer: TimerT): void {
    timer.running = false;
  },

  restart(timer: TimerT): void {
    timer.time = 0;
    timer.running = true;
  },
};
