---
id: lone-admin-recovery
title: Get back in if the only admin is locked out
roles: admin
keywords: locked out, forgot password, only admin, recovery, supabase, second admin
screens: /settings
---
1. Add a second admin first, so that either admin can reset the password of the other.
2. If no admin can sign in, the owner opens the Supabase dashboard (Authentication, then Users).
3. Find the admin email, open the row menu and choose "Send password recovery".
4. The admin opens the email link and sets a new password. The app never sees it.

Tip: There is no second sign-in step, so this email link is the only way back in. Keep the Supabase login of the owner secure.
