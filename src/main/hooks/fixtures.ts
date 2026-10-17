// Real Claude Code 2.1.299 hook payloads captured with scripts/spikes/30-hooks-lab.mjs (PRD §6.6),
// scrubbed of personal paths and ids. `transcript_path` / `scratchpad_dir` are dropped (unused).
// Notification_permission reuses the idle capture's envelope with the message string observed in a separate run.
export const claudeFixtures = {
  "SessionStart": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "hook_event_name": "SessionStart",
    "source": "startup",
    "model": "claude-opus-5-5"
  },
  "UserPromptSubmit": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "auto",
    "hook_event_name": "UserPromptSubmit",
    "prompt": "Reply with only the word OK."
  },
  "Stop": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "auto",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "Stop",
    "stop_hook_active": false,
    "last_assistant_message": "OK",
    "background_tasks": [],
    "session_crons": []
  },
  "SessionEnd": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "hook_event_name": "SessionEnd",
    "reason": "prompt_input_exit"
  },
  "PreToolUse_Bash": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PreToolUse",
    "tool_name": "Bash",
    "tool_input": {
      "command": "echo hooks-lab-ran > /work/project/ran.txt",
      "description": "Write marker text to ran.txt"
    },
    "tool_use_id": "toolu_FIXTURE"
  },
  "PermissionRequest_Bash": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PermissionRequest",
    "tool_name": "Bash",
    "tool_input": {
      "command": "echo hooks-lab-ran > /work/project/ran.txt",
      "description": "Write marker text to ran.txt"
    },
    "permission_suggestions": [
      {
        "type": "addDirectories",
        "directories": [
          "/work/project"
        ],
        "destination": "session"
      }
    ]
  },
  "PostToolUse_Bash": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PostToolUse",
    "tool_name": "Bash",
    "tool_input": {
      "command": "echo hooks-lab-ran > /work/project/ran.txt",
      "description": "Write marker text to ran.txt"
    },
    "tool_response": {
      "stdout": "",
      "stderr": "",
      "interrupted": false,
      "isImage": false,
      "noOutputExpected": false
    },
    "tool_use_id": "toolu_FIXTURE",
    "duration_ms": 365
  },
  "Notification_permission": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "hook_event_name": "Notification",
    "message": "Claude needs your permission",
    "notification_type": "permission_prompt"
  },
  "Notification_idle": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "hook_event_name": "Notification",
    "message": "Claude is waiting for your input",
    "notification_type": "idle_prompt"
  },
  "PostToolUseFailure_Bash": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PostToolUseFailure",
    "tool_name": "Bash",
    "tool_input": {
      "command": "ls /work/project/does-not-exist",
      "description": "List a nonexistent path"
    },
    "tool_use_id": "toolu_FIXTURE",
    "error": "Exit code 1\nls: /work/project/does-not-exist: No such file or directory",
    "is_interrupt": false,
    "duration_ms": 364
  },
  "PreToolUse_AskUserQuestion": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PreToolUse",
    "tool_name": "AskUserQuestion",
    "tool_input": {
      "questions": [
        {
          "question": "Which option do you prefer?",
          "header": "Pick",
          "options": [
            {
              "label": "A",
              "description": "Option A"
            },
            {
              "label": "B",
              "description": "Option B"
            }
          ],
          "multiSelect": false
        }
      ]
    },
    "tool_use_id": "toolu_FIXTURE"
  },
  "PermissionRequest_AskUserQuestion": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PermissionRequest",
    "tool_name": "AskUserQuestion",
    "tool_input": {
      "questions": [
        {
          "question": "Which option do you prefer?",
          "header": "Pick",
          "options": [
            {
              "label": "A",
              "description": "Option A"
            },
            {
              "label": "B",
              "description": "Option B"
            }
          ],
          "multiSelect": false
        }
      ]
    }
  },
  "PostToolUse_AskUserQuestion": {
    "session_id": "00000000-0000-4000-8000-000000000000",
    "cwd": "/work/project",
    "prompt_id": "00000000-0000-4000-8000-000000000000",
    "permission_mode": "default",
    "effort": {
      "level": "medium"
    },
    "hook_event_name": "PostToolUse",
    "tool_name": "AskUserQuestion",
    "tool_input": {
      "questions": [
        {
          "question": "Which option do you prefer?",
          "header": "Pick",
          "options": [
            {
              "label": "A",
              "description": "Option A"
            },
            {
              "label": "B",
              "description": "Option B"
            }
          ],
          "multiSelect": false
        }
      ],
      "answers": {
        "Which option do you prefer?": "A"
      },
      "annotations": {}
    },
    "tool_response": {
      "questions": [
        {
          "question": "Which option do you prefer?",
          "header": "Pick",
          "options": [
            {
              "label": "A",
              "description": "Option A"
            },
            {
              "label": "B",
              "description": "Option B"
            }
          ],
          "multiSelect": false
        }
      ],
      "answers": {
        "Which option do you prefer?": "A"
      },
      "annotations": {}
    },
    "tool_use_id": "toolu_FIXTURE",
    "duration_ms": 2
  }
} as const
