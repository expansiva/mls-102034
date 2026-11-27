/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmInputTypes.ts" enhancement="_blank" />
/**
 * The input types of the operations the cm SERVES (and the types they name), as DATA. `serveCm` checks the input against these at
 * run time: the platform runs compiled, where the source of `cm.ts` is not there to read. A test reads the source of `cm.ts` with the
 * contract reader and demands the same tree, so a change in `cm.ts` that is not copied here fails the suite.
 */
import type { AsTypeNode } from '/_102034_/l1/workflow/assistantContractSource.js';

export const cmServeInputTypes: Record<string, AsTypeNode> = {
  "CmAgentDraftReadyInput": {
    "kind": "object",
    "fields": [
      {
        "name": "draftId",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "status",
        "optional": false,
        "type": {
          "kind": "literal",
          "values": [
            "ready",
            "refused"
          ]
        }
      },
      {
        "name": "refusedReason",
        "optional": true,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "suggestedTools",
        "optional": true,
        "type": {
          "kind": "array",
          "of": {
            "kind": "primitive",
            "name": "string"
          }
        }
      }
    ]
  },
  "CmDescribeInput": {
    "kind": "object",
    "fields": [
      {
        "name": "agentId",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "knownVersion",
        "optional": true,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "authorities",
        "optional": false,
        "type": {
          "kind": "array",
          "of": {
            "kind": "primitive",
            "name": "string"
          }
        }
      },
      {
        "name": "snapshotAt",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      }
    ]
  },
  "CmDisableChannelInput": {
    "kind": "object",
    "fields": [
      {
        "name": "target",
        "optional": false,
        "type": {
          "kind": "union",
          "members": [
            {
              "kind": "object",
              "fields": [
                {
                  "name": "conversationRef",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            },
            {
              "kind": "object",
              "fields": [
                {
                  "name": "botRef",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            }
          ]
        }
      },
      {
        "name": "reason",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      }
    ]
  },
  "CmEnsureAgentMemberInput": {
    "kind": "object",
    "fields": [
      {
        "name": "agentId",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "name",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "active",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "boolean"
        }
      }
    ]
  },
  "CmRecordInput": {
    "kind": "object",
    "fields": [
      {
        "name": "executionId",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "agentId",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "mode",
        "optional": false,
        "type": {
          "kind": "literal",
          "values": [
            "real",
            "rehearsal"
          ]
        }
      },
      {
        "name": "startedAt",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "durationMs",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "number"
        }
      },
      {
        "name": "costUsd",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "number"
        }
      },
      {
        "name": "actions",
        "optional": false,
        "type": {
          "kind": "array",
          "of": {
            "kind": "object",
            "fields": [
              {
                "name": "actionId",
                "optional": false,
                "type": {
                  "kind": "primitive",
                  "name": "string"
                }
              },
              {
                "name": "outcome",
                "optional": false,
                "type": {
                  "kind": "ref",
                  "name": "CmRecordOutcome"
                }
              }
            ]
          }
        }
      },
      {
        "name": "usedMainModel",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "boolean"
        }
      },
      {
        "name": "handedOff",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "boolean"
        }
      },
      {
        "name": "refs",
        "optional": false,
        "type": {
          "kind": "object",
          "fields": [
            {
              "name": "conversationId",
              "optional": true,
              "type": {
                "kind": "primitive",
                "name": "string"
              }
            },
            {
              "name": "taskId",
              "optional": true,
              "type": {
                "kind": "primitive",
                "name": "string"
              }
            },
            {
              "name": "messageId",
              "optional": true,
              "type": {
                "kind": "primitive",
                "name": "string"
              }
            }
          ]
        }
      }
    ]
  },
  "CmRecordOutcome": {
    "kind": "literal",
    "values": [
      "done",
      "refused_rule",
      "forbidden",
      "no_person",
      "not_found",
      "stale_version",
      "invalid_input",
      "unavailable"
    ]
  },
  "CmSendChannelMessageInput": {
    "kind": "object",
    "fields": [
      {
        "name": "to",
        "optional": false,
        "type": {
          "kind": "union",
          "members": [
            {
              "kind": "object",
              "fields": [
                {
                  "name": "conversationRef",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            },
            {
              "kind": "object",
              "fields": [
                {
                  "name": "address",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                },
                {
                  "name": "botRef",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            }
          ]
        }
      },
      {
        "name": "text",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "writtenAt",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "messageRef",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      }
    ]
  },
  "CmSetChannelConversationIdentityInput": {
    "kind": "object",
    "fields": [
      {
        "name": "conversationRef",
        "optional": false,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "identity",
        "optional": true,
        "type": {
          "kind": "union",
          "members": [
            {
              "kind": "object",
              "fields": [
                {
                  "name": "email",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            },
            {
              "kind": "object",
              "fields": [
                {
                  "name": "mdmId",
                  "optional": false,
                  "type": {
                    "kind": "primitive",
                    "name": "string"
                  }
                }
              ]
            }
          ]
        }
      },
      {
        "name": "displayName",
        "optional": true,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      },
      {
        "name": "since",
        "optional": true,
        "type": {
          "kind": "primitive",
          "name": "string"
        }
      }
    ]
  }
};
