# 9950 Shifts Helper Roadmap

Updated: 2026-04-23

## Goal

Turn the project from a strong working prototype into a stable, maintainable, production-ready scheduling system with excellent mobile UX, safe data storage, and better admin operations.

## Product Priorities

1. Data safety and operational stability
2. Code maintainability and test coverage
3. Better user onboarding and daily UX
4. Better admin workflow on mobile
5. Smarter scheduling, reminders, and reporting

---

## Phase 1. Stability And Data Safety

### Goals
- Prevent user and shift data loss
- Make deployments safer
- Improve observability and recovery

### Tasks
- Keep production database on durable storage only
- Prepare clean migration path from SQLite to Postgres
- Verify backup and restore workflow end-to-end
- Add recovery checklist for real incidents
- Add structured logs for critical flows
- Add deployment smoke-checks
- Re-check all admin-only routes and permissions
- Ensure all timezone logic uses a single shared standard

### Output
- Stable production storage strategy
- Documented recovery process
- Better deploy confidence
- Lower risk of disappearing users or shifts

### Priority
Critical

---

## Phase 2. Frontend Structure And Maintainability

### Goals
- Reduce complexity of the frontend
- Make future changes faster and safer

### Tasks
- Split `web/src/App.jsx` into focused components
- Extract data loading into reusable hooks
- Centralize UI text strings
- Centralize date/time/status formatting helpers
- Add unified error boundary
- Add unified notice/toast handling
- Remove repeated UI logic blocks
- Standardize naming across app state and helpers

### Output
- Cleaner codebase
- Easier debugging
- Faster future UI work

### Priority
High

---

## Phase 3. Tests For Critical Logic

### Goals
- Protect the most important flows from regression

### Tasks
- Add tests for `Asia/Jerusalem` timezone logic
- Add DST edge-case tests
- Add tests for active shift progress calculation
- Add tests for shift timing helpers
- Add tests for Excel preview flow
- Add tests for Excel commit flow
- Add tests for duplicate protection
- Add tests for admin-only bot commands
- Add tests for admin-only API routes
- Add smoke tests for main mini app flows

### Output
- Lower risk of breaking time, import, or admin features
- More confidence in releases

### Priority
High

---

## Phase 4. User Onboarding And Core User UX

### Goals
- Make the first-time experience obvious and frictionless
- Improve day-to-day usability for regular users

### Tasks
- Design a clearer onboarding flow from `/start`
- Add a better "pending approval" state
- Improve empty states across the app
- Add skeleton/loading states instead of blank jumps
- Simplify the main user screen further
- Improve shift response UX
- Make important status changes more visible
- Improve mobile spacing and tap ergonomics

### Output
- Easier first use
- Fewer confused users
- Better retention and fewer support questions

### Priority
High

---

## Phase 5. Admin UX And Scheduling Workflow

### Goals
- Make admin tasks fast, clear, and reliable from phone

### Tasks
- Improve mobile calendar usability
- Improve create/edit shift flow
- Add quick duplicate shift action
- Add reusable shift templates
- Add repeating shift creation tools
- Improve shift assignment UX
- Improve import history UX
- Add filter/search in admin views
- Add export of shifts and reports

### Output
- Faster admin operations
- Less manual repetition
- Better control over schedule management

### Priority
High

---

## Phase 6. Notifications And Communication

### Goals
- Make communication more proactive and useful

### Tasks
- Add reminders for users who have not responded
- Add daily summary for users
- Add weekly summary for admins
- Add scheduled broadcasts
- Add segmented broadcasts
- Add delivery/result visibility for broadcasts
- Improve role-aware `/help`

### Output
- Better participation
- Better response rates
- Better admin communication

### Priority
Medium-High

---

## Phase 7. Smarter Shift Operations

### Goals
- Reduce scheduling friction
- Add helpful automation around shift coverage

### Tasks
- Detect shift overlaps and conflicts
- Add assignment suggestions
- Add "looking for replacement" flow
- Add "take this shift" flow
- Add start/end shift confirmation actions
- Add per-shift event history
- Add filtering by date, type, and location

### Output
- Smarter staffing
- Faster reaction to gaps
- Better visibility into shift changes

### Priority
Medium

---

## Phase 8. Analytics And Operational Visibility

### Goals
- Give admins better insight into the system

### Tasks
- Add dashboard for weak/problem days
- Add response and participation analytics
- Add load heatmap by day/time
- Add system status panel
- Add release notes / changelog view
- Add feedback collection flow
- Add staging environment
- Add CI checks for main flows

### Output
- Better decision-making
- Better operational visibility
- Safer release process

### Priority
Medium

---

## Sprint-Based Suggested Order

## Sprint 1
- Durable storage validation
- Backup/restore verification
- Deploy smoke checks
- Admin route audit

## Sprint 2
- Split `App.jsx`
- Extract hooks/helpers
- Centralize UI text and formatting

## Sprint 3
- Add timezone/import/admin permission tests
- Add basic smoke tests

## Sprint 4
- Improve onboarding
- Improve pending approval flow
- Improve empty/loading states

## Sprint 5
- Improve mobile admin UX
- Improve create/edit shift flow
- Add duplicate shift and templates

## Sprint 6
- Add no-response reminders
- Add summaries and better broadcast tooling

## Sprint 7
- Add conflict detection
- Add replacement/take-shift flows

## Sprint 8
- Add analytics, CI, staging, and operational dashboards

---

## What Should Be Done First

### Immediate top priority
- Durable storage and restore safety
- Frontend refactor for maintainability
- Tests for time, import, and permissions

### Next priority
- Onboarding and pending approval UX
- Better admin workflow on phone
- Reminder improvements

### After that
- Scheduling intelligence
- Reporting and analytics
- Staging and CI maturity

---

## Definition Of Success

The roadmap can be considered successful when:
- data is safe across deploys and incidents
- time and reminders are consistently correct
- main user flows are easy on mobile
- admin tasks are fast enough from phone
- releases are safer and easier to verify
- the project can continue growing without turning fragile

