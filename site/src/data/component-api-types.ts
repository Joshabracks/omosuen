export interface ApiField {
  key: string;
  type: string;
  desc: string;
  /** Literal expression for create examples (required fields and optionals with builder defaults). */
  default?: string;
}

export interface ApiMethodArg {
  name: string;
  type: string;
  desc: string;
}

export interface ApiMethod {
  key: string;
  signature: string;
  desc: string;
  args?: ApiMethodArg[];
}

export interface ComponentApiDoc {
  options: ApiField[];
  data: ApiField[];
  methods: ApiMethod[];
}
