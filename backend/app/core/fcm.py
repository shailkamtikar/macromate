"""Firebase Cloud Messaging delivery — isolated behind this interface so
the trigger-evaluation logic (app/domain/notifications.py) never depends
on whether push is actually configured.

STATUS: not configured in this environment. FCM_SERVER_KEY is empty in
backend/.env. Sending a real push additionally requires, beyond that one
key:
  1. A Firebase project with Cloud Messaging enabled.
  2. For the modern HTTP v1 API (the legacy server-key API this env var
     implies is deprecated by Google): a service account JSON credential,
     not just a bare key.
  3. On the frontend: the Firebase Web SDK initialized with that project's
     config, a registered service worker (firebase-messaging-sw.js) to
     receive push events, and user permission granted via
     Notification.requestPermission() — none of which exist yet, since
     there's no Firebase project to point them at.
  4. A place to store each user's FCM registration token server-side
     (no such table exists in the current schema — would need one, e.g.
     `push_tokens(user_id, token, platform)`).

None of this is faked. send_push() below fails loudly and specifically
rather than pretending to deliver.
"""

from app.core.config import get_settings


class FcmNotConfigured(Exception):
    pass


def send_push(*, device_token: str, title: str, body: str) -> None:
    settings = get_settings()
    if not settings.fcm_server_key:
        raise FcmNotConfigured(
            "FCM_SERVER_KEY is not set. See app/core/fcm.py module docstring "
            "for the full list of missing prerequisites (Firebase project, "
            "service account, frontend SDK + service worker, token storage)."
        )
    # Deliberately not implemented further: there is no Firebase project
    # to send to yet, and this env var alone is not enough per the module
    # docstring even once "configured" in the .env-has-a-value sense.
    raise FcmNotConfigured(
        "FCM_SERVER_KEY is present but push delivery is not wired up — "
        "see app/core/fcm.py for what's still missing."
    )
