import { ComponentData } from "../types";

export interface nexus extends ComponentData {
  type: "nexus";
  unique: false;
  components: ComponentData[];
  paused: boolean;
}
