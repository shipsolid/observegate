export type FieldContract =
  | "string"
  | "number"
  | "boolean"
  | "any"
  | { readonly [key: string]: FieldContract }
  | { readonly anyOf: readonly FieldContract[] }
  | readonly FieldContract[];

export const gateContracts: Readonly<Record<string, Readonly<Record<string, FieldContract>>>> = {
  "policy.self_check": {
    assertions: {
      require_sections: ["string"],
      unique_gate_ids: "boolean",
      reject_unknown_fields: "boolean",
      reject_inline_secrets: "boolean",
      require_at_least_one_blocking_post_gate: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "identity.contract": {
    assertions: {
      required_values: {
        service_name: "string",
        service_namespace: "string",
        environment: "string",
        release_id: "string"
      },
      release_id: {
        minimum_length: "number",
        maximum_length: "number",
        forbidden_values: ["string"]
      },
      environment: {
        allowed_pattern: "string"
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "asset.metadata": {
    source: {
      files: ["string"],
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      owner_present: "boolean",
      owner_is_not_placeholder: "boolean",
      escalation_contact_present: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "asset.url": {
    source: {
      url_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      schemes: ["string"],
      expected_status: ["number"],
      maximum_redirects: "number",
      require_nonempty_document: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.dashboard": {
    source: {
      provider: "string",
      uid_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      exists: "boolean",
      title_contains: "string",
      minimum_panels: "number",
      required_panel_signals: ["string"],
      required_template_variables: ["string"]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.alert_rules": {
    source: {
      provider: "string",
      labels: {
        "*": "string"
      },
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      minimum_enabled_rules: "number",
      require_severity_label: "boolean",
      require_owner_label: "boolean",
      require_runbook_annotation: "boolean",
      forbid_no_data_ok_on_critical_rules: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.notification_policy": {
    source: {
      provider: "string",
      match: {
        "*": "string"
      },
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      route_exists: "boolean",
      receiver_is_configured: "boolean",
      mute_timing_does_not_cover_deployment_window: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.slo_definition": {
    source: {
      provider: "string",
      uid_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      exists: "boolean",
      objective_percent: {
        minimum: "number",
        maximum: "number"
      },
      window: {
        minimum: "string"
      },
      indicator_query_is_valid: "boolean",
      labels_match_identity: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.query_validation": {
    sources: {
      metrics: "string",
      logs: "string",
      traces: "string"
    },
    assertions: {
      validate_queries_from: ["string"],
      require_scalar_for_threshold_gates: "boolean",
      reject_unbounded_log_queries: "boolean",
      reject_high_cardinality_grouping: ["string"],
      maximum_query_range: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "artifact.instrumentation_configuration": {
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      require_service_name: "boolean",
      require_service_version: "boolean",
      require_environment: "boolean",
      require_otlp_endpoint_or_agent: "boolean",
      require_metrics_enabled: "boolean",
      require_logs_enabled: "boolean",
      require_traces_enabled: "boolean",
      forbid_debug_exporter_in_production: "boolean",
      forbid_plaintext_otlp_outside_localhost: "boolean",
      forbid_hardcoded_credentials: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "evidence.sarif": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    assertions: {
      fail_on_levels: ["string"],
      warn_on_levels: ["string"],
      accepted_rule_families: ["string"]
    }
  },
  "evidence.otlp_contract": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      require_signals: ["string"],
      require_resource_attributes: ["string"],
      attribute_values: {
        "*": "string"
      },
      require_trace_log_correlation: "boolean",
      require_span_status_on_errors: "boolean",
      require_http_route_normalization: "boolean",
      forbid_metric_labels: ["string"],
      forbid_sensitive_fields: ["string"]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.pipeline_configuration": {
    source: {
      files: ["string"],
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      receiver_exists: "boolean",
      processors_include: ["string"],
      exporters_exist_for: ["string"],
      service_pipeline_references_exporters: "boolean",
      retry_enabled: "boolean",
      sending_queue_enabled: "boolean",
      tls_verification_enabled: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "synthetic.plan": {
    source: {
      files: ["string"],
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      at_least_one_file_exists: "boolean",
      has_timeout: "boolean",
      has_success_assertion: "boolean",
      has_release_identity_assertion: "boolean",
      does_not_log_secrets: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "policy.coverage": {
    source: {
      phase: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      require_blocking_categories: ["string"],
      require_platform_specific_readiness: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "providers.health": {
    assertions: {
      providers: ["string"],
      maximum_latency: "string",
      authentication_valid: "boolean",
      query_permissions_valid: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "metric.threshold": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      operator: "string",
      threshold: "number",
      minimum_samples: "number",
      unit: "string",
      minimum_total_requests: "number",
      minimum_requests: "number",
      request_count_query: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.slo_status": {
    source: {
      provider: "string",
      uid_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      status: ["string"],
      maximum_data_age: "string",
      include_candidate_window: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.error_budget": {
    source: {
      provider: "string",
      uid_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      remaining_percent: {
        greater_than_or_equal: "number"
      },
      consumed_during_release_percent: {
        less_than_or_equal: "number"
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.burn_rate": {
    source: {
      provider: "string",
      uid_env: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      windows: [
        {
          short: "string",
          long: "string",
          maximum: "number",
          short_query: "string",
          long_query: "string"
        }
      ]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "grafana.alert_state": {
    source: {
      provider: "string",
      labels: {
        "*": "string"
      },
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      forbidden_states: ["string"],
      forbidden_severities: ["string"],
      pending_critical_is_failure: "boolean",
      require_started_after: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "evidence.incident_state": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    assertions: {
      affected_service: "string",
      affected_environment: "string",
      forbidden_states: ["string"],
      minimum_severity: "string"
    }
  },
  "dependency.health": {
    dependencies: [
      {
        name: "string",
        required: "boolean",
        source: {
          provider: "string",
          query: "string"
        },
        assertions: {
          operator: "string",
          threshold: "number",
          minimum_samples: "number",
          unit: "string",
          minimum_total_requests: "number",
          minimum_requests: "number",
          request_count_query: "string"
        },
        query: "string",
        threshold: {
          greater_than_or_equal: "number"
        }
      }
    ],
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      all_required_dependencies_must_pass: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.collector_health": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      queries: {
        export_failures: "string",
        refused_data: "string",
        queue_utilization: "string"
      },
      thresholds: {
        export_failures: {
          less_than_or_equal: "number"
        },
        refused_data: {
          less_than_or_equal: "number"
        },
        queue_utilization: {
          less_than_or_equal: "number"
        }
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "runtime.capacity": {
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      cpu_headroom_percent: {
        greater_than_or_equal: "number"
      },
      memory_headroom_percent: {
        greater_than_or_equal: "number"
      },
      disk_headroom_percent: {
        greater_than_or_equal: "number"
      },
      desired_surge_can_be_scheduled: "boolean"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "policy.change_window": {
    source: {
      file: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      current_time_allowed: "boolean",
      freeze_requires_approved_exception: "boolean",
      exception: {
        environment_variable: "string",
        require_reason_env: "string",
        require_approver_env: "string",
        approved: "boolean",
        id: "string",
        reason: "string",
        approver: "string"
      },
      timezone: "string",
      freezes: [
        {
          start: "string",
          end: "string"
        }
      ]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "deployment.concurrency": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      operator: "string",
      threshold: "number",
      exclude_deployment_id: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.cardinality_estimate": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      new_metric_series: {
        less_than_or_equal: "number"
      },
      new_log_attribute_keys: {
        less_than_or_equal: "number"
      },
      new_span_attribute_keys: {
        less_than_or_equal: "number"
      },
      estimated_series_growth_percent: {
        less_than_or_equal: "number"
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.volume_estimate": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      estimated_growth_percent: {
        metrics: {
          less_than_or_equal: "number"
        },
        logs: {
          less_than_or_equal: "number"
        },
        traces: {
          less_than_or_equal: "number"
        }
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "kubernetes.manifest": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      workload_exists: "boolean",
      container_exists: "boolean",
      image_is_digest_pinned: "boolean",
      image_digest_env: "string",
      namespace_is_explicit: "boolean",
      forbid_latest_tag: "boolean",
      forbid_privileged: "boolean",
      read_only_root_filesystem: "boolean"
    }
  },
  "kubernetes.probes": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      readiness_probe_required: "boolean",
      liveness_probe_required: "boolean",
      startup_probe_required_when_startup_exceeds: "string",
      readiness_probe_must_not_check_optional_dependencies: "boolean",
      timeout_seconds: {
        maximum: "number"
      },
      failure_threshold: {
        minimum: "number"
      }
    }
  },
  "kubernetes.resources": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      requests_required: ["string"],
      limits_required: ["string"],
      request_must_not_exceed_limit: "boolean",
      production_minimum_replicas: "number",
      disruption_budget_for_multiple_replicas: "boolean"
    }
  },
  "kubernetes.rollout_strategy": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      allowed_strategies: ["string"],
      max_unavailable: {
        less_than_or_equal: "number"
      },
      progress_deadline_required: "boolean",
      minimum_ready_seconds: {
        greater_than_or_equal: "number"
      }
    }
  },
  "azure_container_apps.configuration": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      image_is_digest_pinned: "boolean",
      revision_mode: ["string"],
      ingress_transport_declared: "boolean",
      minimum_replicas: {
        greater_than_or_equal: "number"
      },
      maximum_replicas: {
        greater_than_or_equal: "number"
      },
      otel_environment_present: "boolean",
      managed_identity_preferred: "boolean"
    }
  },
  "azure_container_apps.probes": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      startup_probe_required: "boolean",
      readiness_probe_required: "boolean",
      liveness_probe_required: "boolean",
      probe_ports_match_ingress: "boolean"
    }
  },
  "vm.release_identity": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      artifact_digest_declared: "boolean",
      release_marker_declared: "boolean",
      service_version_environment_declared: "boolean",
      rollback_artifact_declared: "boolean"
    }
  },
  "vm.service_definition": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      artifacts: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      automatic_restart_on_failure: "boolean",
      bounded_restart_delay: "boolean",
      startup_timeout_declared: "boolean",
      graceful_shutdown_declared: "boolean",
      non_admin_identity: "boolean",
      telemetry_agent_dependency_declared: "boolean"
    }
  },
  "vm.capacity": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      cpu_headroom_percent: {
        greater_than_or_equal: "number"
      },
      memory_headroom_percent: {
        greater_than_or_equal: "number"
      },
      disk_free_percent: {
        greater_than_or_equal: "number"
      },
      healthy_hosts_percent: {
        greater_than_or_equal: "number"
      }
    }
  },
  "runtime.provisioned": {
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      resource_exists: "boolean",
      provisioning_state: ["string"],
      observed_after: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "runtime.ready": {
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      ready: "boolean",
      available_instances: {
        greater_than_or_equal: "string"
      },
      unavailable_instances: {
        less_than_or_equal: "number"
      },
      consecutive_successful_samples: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "runtime.release_identity": {
    source: {
      adapter: "string",
      deployment_evidence: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      expected_release_id: "string",
      expected_image_digest_env: "string",
      expected_artifact_digest_env: "string",
      require_no_unexpected_release_instances: "boolean",
      deployment_id: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.presence": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      operator: "any",
      threshold: "any",
      minimum_records: "any",
      minimum_traces: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.freshness": {
    sources: {
      metrics: "string",
      logs: "string",
      traces: "string"
    },
    selectors: {
      service_name: "string",
      service_namespace: "string",
      environment: "string",
      release_id: "string"
    },
    assertions: {
      maximum_age: {
        metrics: "string",
        logs: "string",
        traces: "string"
      },
      maximum_future_skew: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.contract": {
    source: {
      providers: ["string"],
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      required_signals: ["string"],
      required_resource_attributes: ["string"],
      expected_values: {
        "*": "string"
      },
      require_http_server_duration_metric: "boolean",
      require_error_logs_on_failed_requests: "boolean",
      require_server_spans: "boolean",
      forbid_sensitive_fields: ["string"]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.identity_consistency": {
    sources: {
      runtime: "string",
      metrics: "string",
      logs: "string",
      traces: "string",
      deployment_evidence: "string"
    },
    assertions: {
      compare: ["string"],
      expected_release_id: "string",
      maximum_distinct_release_ids: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.correlation": {
    source: {
      traces: "string",
      logs: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    selectors: {
      service_name: "string",
      environment: "string",
      release_id: "string"
    },
    assertions: {
      sampled_error_traces: "number",
      minimum_correlated_percent: "number",
      log_fields: ["string"]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "telemetry.service_graph": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      caller_present: "boolean",
      required_dependencies: ["string"],
      maximum_unknown_peer_percent: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "metric.multi_threshold": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      queries: {
        cpu_utilization: "string",
        memory_utilization: "string",
        queue_utilization: "string"
      },
      thresholds: {
        cpu_utilization: {
          less_than_or_equal: "number"
        },
        memory_utilization: {
          less_than_or_equal: "number"
        },
        queue_utilization: {
          less_than_or_equal: "number"
        }
      }
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "runtime.stability": {
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      unexpected_restarts: {
        less_than_or_equal: "number"
      },
      crash_loops: {
        less_than_or_equal: "number"
      },
      out_of_memory_terminations: {
        less_than_or_equal: "number"
      },
      unhealthy_instances: {
        less_than_or_equal: "number"
      },
      evaluation_window: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "comparison.metric": {
    source: {
      provider: "string",
      metric: "string",
      candidate: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      },
      baseline: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      },
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      absolute_increase_percentage_points: "any",
      relative_increase_percent: "any",
      minimum_candidate_requests: "number",
      minimum_baseline_requests: "number",
      absolute_increase: "any",
      absolute_decrease_percentage_points: {
        less_than_or_equal: "number"
      },
      minimum_candidate_samples: "number",
      minimum_baseline_samples: "number",
      maximum_absolute_regression: "number",
      maximum_relative_regression_percent: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "comparison.multi_metric": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string",
      candidate: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      },
      baseline: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      }
    },
    metrics: ["string"],
    candidate: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    baseline: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    assertions: {
      normalized_per_request: "boolean",
      relative_increase_percent: {
        cpu: "number",
        memory: "number"
      },
      minimum_candidate_samples: "number",
      minimum_baseline_samples: "number",
      maximum_absolute_regression: "number",
      maximum_relative_regression_percent: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "comparison.trace_metrics": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string",
      candidate: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      },
      baseline: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      }
    },
    candidate: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    baseline: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    assertions: {
      dependencies: ["string"],
      p95_relative_increase_percent: {
        less_than_or_equal: "number"
      },
      p95_absolute_increase: {
        less_than_or_equal: "number",
        unit: "string"
      },
      minimum_candidate_samples: "number",
      minimum_baseline_samples: "number",
      maximum_absolute_regression: "number",
      maximum_relative_regression_percent: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "comparison.telemetry_volume": {
    source: {
      providers: ["string"],
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string",
      candidate: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      },
      baseline: {
        release_id: "string",
        query: "string",
        request_count_query: "string"
      }
    },
    candidate: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    baseline: {
      release_id: "string",
      query: "string",
      request_count_query: "string"
    },
    assertions: {
      relative_increase_percent: {
        metric_series: "number",
        log_bytes: "number",
        spans: "number"
      },
      normalized_per_request: "boolean",
      minimum_candidate_samples: "number",
      minimum_baseline_samples: "number",
      maximum_absolute_regression: "number",
      maximum_relative_regression_percent: "number"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "synthetic.result": {
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    assertions: {
      required_tests: ["string"],
      pass_rate_percent: {
        greater_than_or_equal: "number"
      },
      maximum_duration: "any",
      release_identity_header: {
        name: "string",
        equals: "string"
      }
    }
  },
  "http.assertion": {
    source: {
      provider: "string",
      url: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      method: "any",
      expected_status: "any",
      maximum_duration: "any",
      response_headers: {
        "x-service-version": "any",
        "*": "string"
      },
      response_json: {
        status: "any",
        "*": "any"
      },
      expected_headers: {
        "*": "string"
      },
      expected_json: {
        "*": "any"
      },
      expected_statuses: ["number"]
    },
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    }
  },
  "kubernetes.rollout_status": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      observed_generation_matches: "boolean",
      progressing_condition: "boolean",
      available_condition: "boolean",
      updated_replicas_equal_desired: "boolean",
      available_replicas_equal_desired: "boolean",
      unavailable_replicas: {
        less_than_or_equal: "number"
      },
      rollout_completed_within: "string"
    }
  },
  "kubernetes.image_identity": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      expected_digest_env: "string",
      all_ready_pods_match: "boolean",
      forbid_mutable_tag_only_identity: "boolean"
    }
  },
  "kubernetes.pod_health": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      ready_percent: {
        greater_than_or_equal: "number"
      },
      restart_increase: {
        less_than_or_equal: "number"
      },
      forbidden_waiting_reasons: ["string"],
      forbidden_termination_reasons: ["string"]
    }
  },
  "kubernetes.events": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      since: "string",
      forbidden_reasons: ["string"],
      maximum_warning_events: "number"
    }
  },
  "azure_container_apps.revision_status": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      provisioning_state: ["string"],
      running_state: ["string"],
      active: "boolean",
      healthy_replicas: {
        greater_than_or_equal: "number"
      },
      failed_replicas: {
        less_than_or_equal: "number"
      }
    }
  },
  "azure_container_apps.image_identity": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      expected_digest_env: "string",
      expected_revision_suffix_env: "string",
      all_containers_match: "boolean"
    }
  },
  "azure_container_apps.traffic": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      candidate_revision_env: "string",
      minimum_candidate_weight_percent: "number",
      maximum_unknown_revision_weight_percent: "number",
      weights_sum_to_percent: "number"
    }
  },
  "azure_container_apps.replica_health": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      restart_increase: {
        less_than_or_equal: "number"
      },
      unhealthy_replicas: {
        less_than_or_equal: "number"
      },
      activation_failures: {
        less_than_or_equal: "number"
      },
      deactivation_failures: {
        less_than_or_equal: "number"
      }
    }
  },
  "azure_vm.instance_view": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      adapter: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      provisioning_state: ["string"],
      power_state: ["string"],
      platform_maintenance_active: "boolean"
    }
  },
  "vm.service_health": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      healthy_hosts_percent: {
        greater_than_or_equal: "number"
      },
      unexpected_restart_increase: {
        less_than_or_equal: "number"
      },
      exit_code: "any",
      failed_units: {
        less_than_or_equal: "number"
      }
    }
  },
  "vm.release_marker": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      expected_release_id: "string",
      healthy_hosts_percent: {
        greater_than_or_equal: "number"
      },
      maximum_distinct_release_ids: "number",
      deployment_marker_env: "string"
    }
  },
  "vm.host_health": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      cpu_utilization: {
        less_than_or_equal: "number"
      },
      memory_utilization: {
        less_than_or_equal: "number"
      },
      disk_utilization: {
        less_than_or_equal: "number"
      },
      load_or_queue_saturation: {
        less_than_or_equal: "number"
      },
      unavailable_hosts: {
        less_than_or_equal: "number"
      }
    }
  },
  "vm.agent_health": {
    when: {
      phase: {
        anyOf: ["string", ["string"]]
      },
      runtime_type: {
        anyOf: ["string", ["string"]]
      },
      operating_system: {
        anyOf: ["string", ["string"]]
      },
      provider_available: {
        anyOf: ["string", ["string"]]
      }
    },
    source: {
      provider: "string",
      query: {
        anyOf: [
          "string",
          {
            "resource.service.name": "string",
            "resource.service.namespace": "string",
            "resource.service.version": "string",
            "resource.deployment.environment.name": "string"
          }
        ]
      },
      queries: {
        "*": {
          anyOf: [
            "string",
            {
              candidate: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              baseline: {
                release_id: "string",
                query: "string",
                request_count_query: "string"
              },
              candidate_query: "string",
              baseline_query: "string",
              candidate_request_count_query: "string",
              baseline_request_count_query: "string",
              unit: "string"
            }
          ]
        }
      },
      request_count_query: "string",
      candidate_query: "string",
      baseline_query: "string",
      files: ["string"],
      file: "string",
      url: "string",
      url_env: "string",
      uid: "string",
      uid_env: "string",
      caller: "string",
      traffic_observed: "boolean",
      sampling_probability: "number",
      runtime_release_query: "string",
      probes: {
        "*": {
          query: {
            anyOf: [
              "string",
              {
                "resource.service.name": "string",
                "resource.service.namespace": "string",
                "resource.service.version": "string",
                "resource.deployment.environment.name": "string"
              }
            ]
          },
          uid: "string"
        }
      },
      candidate_request_count_query: "string",
      baseline_request_count_query: "string",
      window: "string"
    },
    assertions: {
      agent_up_percent: {
        greater_than_or_equal: "number"
      },
      export_failure_rate: {
        less_than_or_equal: "number"
      },
      queue_utilization: {
        less_than_or_equal: "number"
      },
      last_successful_export_age: {
        less_than_or_equal: "string"
      }
    }
  }
};
