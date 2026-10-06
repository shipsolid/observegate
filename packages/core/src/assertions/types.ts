export type AssertionUnit =
  | "percent"
  | "ratio"
  | "count"
  | "seconds"
  | "milliseconds"
  | "bytes"
  | "bytes_per_second"
  | "requests_per_second"
  | "events_per_second";

export type NumericAssertionType =
  "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal";

interface AssertionBase {
  readonly label?: string;
}

interface ExpectedAssertion extends AssertionBase {
  readonly expected: unknown;
}

export interface NumericAssertion extends AssertionBase {
  readonly type: NumericAssertionType;
  readonly expected: number;
  readonly unit?: AssertionUnit;
}

export interface CountAssertion extends AssertionBase {
  readonly type: "count";
  readonly operator:
    | "equals"
    | "not_equals"
    | "greater_than"
    | "greater_than_or_equal"
    | "less_than"
    | "less_than_or_equal";
  readonly expected: number;
}

export interface FreshnessAssertion extends AssertionBase {
  readonly type: "freshness";
  readonly maximumAgeMs: number;
}

export interface CompositeAssertion extends AssertionBase {
  readonly type: "all" | "any";
  readonly assertions: readonly AssertionDefinition[];
}

export interface MinimumPassingAssertion extends AssertionBase {
  readonly type: "minimum_passing";
  readonly minimum: number;
  readonly assertions: readonly AssertionDefinition[];
}

export type AssertionDefinition =
  | ({ readonly type: "equals" | "not_equals" } & ExpectedAssertion)
  | ({ readonly type: "allowed_values" | "forbidden_values" } & AssertionBase & {
        readonly expected: readonly unknown[];
      })
  | ({ readonly type: "present" | "absent" } & AssertionBase)
  | NumericAssertion
  | CountAssertion
  | FreshnessAssertion
  | CompositeAssertion
  | MinimumPassingAssertion;

export interface NumericValue {
  readonly value: number;
  readonly unit?: AssertionUnit;
}
