---
id: lone-admin-recovery
title: Get back in if the only admin is locked out
roles: admin
keywords: locked out, forgot password, only admin, recovery, supabase, second admin
screens: /settings
---
1. Best fix first: add a second admin now, so one can always reset the other's password.
2. If nobody can sign in, the owner opens the Supabase dashboard (the project's Authentication, then Users).
3. Find the admin's email, open the row menu and choose "Send password recovery".
4. The admin opens the email link and sets a new password. The app never sees it.

Tip: There is no second sign-in step, so this email link is the only way back in. Keep the owner's Supabase login safe.
