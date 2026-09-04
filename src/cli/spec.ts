export interface ArgSpec {
  name: string;
  required: boolean;
  description: string;
}

export interface FlagSpec {
  name: string;
  type: "string" | "boolean";
  default?: string | boolean;
  values?: readonly string[];
  description: string;
}

export interface CommandSpec {
  name: string;
  summary: string;
  args?: ArgSpec[];
  flags: FlagSpec[];
  examples: string[];
}
