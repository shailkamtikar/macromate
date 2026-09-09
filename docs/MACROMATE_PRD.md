# MacroMate — Product Requirements Document

**Version:** 1.0
**Status:** Draft
**Platform:** Web app (responsive — optimized for both desktop and mobile browsers)

---

## 1. Overview

MacroMate is a modern, cross-platform (web-first, mobile-responsive) nutrition and fitness tracking app that goes beyond raw calorie counting. It combines macro tracking, an AI nutrition assistant, social accountability, and habit-reinforcing motivation mechanics to help users actually stick to their diet and fitness goals — not just log data.

### 1.1 Problem Statement
Most nutrition trackers (MyFitnessPal, Cronometer, etc.) are functional but demotivating — they're spreadsheets with a UI. Users log data but get little intelligent feedback, no real social accountability, and no help figuring out *what to actually eat* to hit their remaining macros. MacroMate solves this by pairing tracking with an AI assistant, social competition, and positive-reinforcement notifications.

### 1.2 Goals
- Make daily macro tracking fast and frictionless
- Give real-time, actionable food suggestions instead of just deficit numbers
- Build a habit loop through streaks, small-win celebrations, and social comparison
- Provide an AI chatbot that acts as an on-demand nutrition coach
- Aggregate health data (steps, workouts) from external sources automatically

### 1.3 Success Metrics
- Daily Active Users / Weekly Active Users ratio (stickiness)
- % of users who log food ≥5 days/week after week 2
- Average streak length
- Chatbot engagement rate (messages per active user per week)
- Friend-comparison feature adoption (% of users with ≥1 friend connected)

---

## 2. Target Users
- Fitness-conscious individuals tracking macros for muscle gain, fat loss, or maintenance
- Users who've tried and abandoned other trackers due to lack of motivation/engagement
- Socially-motivated users who respond well to friendly competition
- Users who want quick answers ("what should I eat right now") rather than manual database searching

---

## 3. Feature Requirements

### 3.1 Water Tracking (Custom Glass Sizes)
- Users can define custom glass/container sizes (e.g., 250ml, 500ml bottle, 1L jug)
- Log water intake with one tap per container
- Daily water goal (auto-suggested based on weight/activity, editable by user)
- Visual progress indicator (fill animation or ring)

### 3.2 Custom Food Creation (Global/Shared Database)
- Users can create custom food entries: name, serving size, calories, protein, carbs, fat, (optional: fiber, sugar, sodium)
- Custom foods are submitted to a **shared, global food database** visible to all users
- Basic duplicate-detection/search when creating (avoid flooding DB with duplicates of common foods, e.g. "Banana")
- Attribution: show "added by [username]" optionally; allow reporting incorrect entries
- Moderation: flag/report system for inaccurate or spam entries (admin review queue)

### 3.3 In-App AI Chatbot
- Chatbot has context on the user's: current macros logged today, remaining macros, BMI, goal (cut/bulk/maintain), recent weight trend
- Can answer questions like:
  - "How much protein do I have left today?"
  - "Is my BMI healthy?"
  - "What should my maintenance calories be?"
  - "Suggest a dinner under 500 cal with 30g protein"
- Model: **Gemini 3.6 Flash** (primary) with automatic fallback to **Gemini 3.5 Flash-Lite** on rate-limit/error
- Chat history persisted per user (at least recent session, ideally full history with pagination)
- Guardrails: chatbot should not give medical advice, diagnose conditions, or recommend extreme deficits — redirect to a professional for medical concerns

### 3.4 Motivating Notifications
- Push notifications (web push / FCM) triggered on:
  - Logging reminders (customizable times, e.g. "Don't forget to log lunch!")
  - Streak-at-risk warnings (e.g. "Log something before midnight to keep your 12-day streak!")
  - Macro-close-to-goal nudges ("You're 20g protein away from your goal today!")
- User-configurable notification frequency/quiet hours

### 3.5 Smart Food Suggestions (Remaining Macros)
- Given remaining macros (e.g. "200 cal, 25g protein left"), suggest 2–3 matching foods/combinations from the food database
- Matching logic: server-side constraint search over the food DB filtered by remaining macro budget (not pure AI — AI only used to phrase the suggestion naturally)
- Suggestions should respect dietary flags if implemented later (vegetarian, vegan, allergies — see Future Considerations)
- Example output: *"You've got 200 cal and 25g protein left — try 2 boiled eggs + a small Greek yogurt, or a protein shake."*

### 3.6 Social Comparison / Friend Competition
- Add friends via username/email/invite link
- Friend leaderboard views:
  - Weekly protein/macro-goal adherence %
  - Logging streak comparison
  - "Discipline score" (composite metric — e.g. % of days macro goals were hit)
- Privacy controls: user can opt out of leaderboard visibility, or make profile friends-only
- Realtime or near-realtime updates (Supabase Realtime)

### 3.7 Weekly Reports
- Auto-generated weekly summary comparing current week vs. previous week:
  - Avg. daily protein/carbs/fat/calories vs. last week
  - Adherence % (days goals were hit)
  - Weight trend
  - Notable wins ("You hit your protein goal 6/7 days — up from 3/7 last week!")
- Delivered via in-app card + optional push notification/email

### 3.8 Micro-Achievement Celebrations
- Positive reinforcement triggers on small wins, not just big milestones:
  - Weight logged lower than last entry → celebratory animation/message
  - Macro goal hit for the day → confetti/cheer
  - New streak milestone (3, 7, 14, 30 days) → badge/animation
- Tone should be encouraging, never shaming (no negative reinforcement for missed goals)

### 3.9 Health Data Integration
- **Android:** Health Connect API (free) — read aggregated steps and workouts from any connected source app (Google Fit, Strava, Samsung Health, etc.), with explicit user permission
- **iOS:** HealthKit (separate integration effort, not covered by Health Connect)
- Synced data feeds into: daily activity summary, adjusted calorie targets (optional, based on activity level), weekly report

---

## 4. Technical Architecture

### 4.1 Frontend
- Prototyped/designed in Google Stitch, implemented in a production framework (React/Next.js recommended for a single responsive codebase covering desktop + mobile web)
- Responsive design — mobile-first, scales up to desktop layouts
- PWA-capable (for push notifications + installability on mobile, no app store needed initially)

### 4.2 Backend
- **FastAPI** (Python) — handles business logic: macro calculations, food suggestion matching, chatbot orchestration, notification triggers, weekly report generation

### 4.3 Database & Auth
- **Supabase** (PostgreSQL + Auth + Row Level Security + Realtime)
- RLS used to separate: private user logs, public/global food database, friend-visible stats
- Supabase Realtime powers live friend leaderboard updates

### 4.4 AI Layer
- **Gemini 3.6 Flash** — primary model for chatbot (better reasoning) and natural-language food suggestion phrasing
- **Gemini 3.5 Flash-Lite** — automatic fallback on rate-limit or error, and used for lightweight/high-frequency tasks if cost/quota becomes a concern
- Shared backend wrapper function for all Gemini calls (single point for model selection, fallback logic, token usage logging)

### 4.5 Notifications
- Firebase Cloud Messaging (FCM) — free tier, works for both web push and future native mobile apps

### 4.6 Health Data
- Health Connect API (Android, free)
- HealthKit (iOS, future scope)

---

## 5. High-Level Data Model

- **users** — profile, goals (cut/bulk/maintain), BMI inputs (height, weight), macro targets
- **weight_logs** — timestamped weight entries per user
- **food_items** — global shared food database (name, macros per serving, created_by, verified flag)
- **food_logs** — user's daily logged food entries (references food_items)
- **water_logs** — user's daily water intake entries
- **glass_sizes** — user-defined container sizes
- **friendships** — friend connections, status (pending/accepted)
- **weekly_reports** — generated summary snapshots per user per week
- **notifications_settings** — per-user notification preferences
- **chat_history** — chatbot conversation logs per user
- **activity_logs** — synced steps/workouts from Health Connect/HealthKit

---

## 6. Non-Functional Requirements
- Fast logging flow — food/water logging should take ≤2 taps for common actions
- Mobile-responsive performance — sub-2s load on 4G
- Data privacy — users control visibility of their stats to friends; health data never sold/shared externally
- AI cost control — token usage logging and fallback logic to stay within free-tier limits during early growth

---

## 7. Out of Scope (v1) / Future Considerations
- Native iOS/Android apps (v1 is responsive web/PWA only)
- Dietary restriction filters (vegetarian, vegan, allergies) in food suggestions
- Barcode scanning for food logging
- Meal planning / recipe generation
- Integration with wearables directly (beyond Health Connect/HealthKit aggregation)
- Monetization (premium tier, ads) — not defined in this version

---

## 8. Open Questions
- Should the global food database require moderation/approval before appearing in search, or go live immediately with a report/flag system?
- What's the exact formula for the "discipline score" used in friend comparisons?
- Should weekly reports be purely descriptive, or include AI-generated commentary (would use additional Gemini calls)?
- iOS HealthKit integration — v1 or post-launch?
