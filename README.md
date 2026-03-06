# TimeTracker — Engineering Time & Billing System

A web-based time tracking and invoicing system for engineering companies.

## Requirements
- Node.js 18 or higher (download from https://nodejs.org)
- npm (comes with Node.js)

## Setup (First Time)

1. Unzip this folder somewhere on your computer
2. Open a terminal / command prompt
3. Navigate to the timetracker folder:
   ```
   cd timetracker
   ```
4. Install all dependencies:
   ```
   npm run install:all
   ```
5. Start the app:
   ```
   npm run dev
   ```
6. Open your browser to: **http://localhost:3000**

## Default Login
- **Email:** admin@company.com
- **Password:** admin123

⚠️ Change this password after your first login!

## Getting Started
1. Go to **Customers** and add your clients
2. Go to **Projects** and add projects under each customer (include PO number and PO dollar amount)
3. Go to **Engineers** and create accounts for each engineer, assign them to projects with their pay rate and bill rate
4. Share the app URL with your engineers so they can log in and submit timesheets

## Running on Your Network (so engineers can access it)
To let engineers on your local network access it, run:
```
cd server && node index.js
```
Then share your computer's local IP address (e.g. http://192.168.1.x:3001).

For internet access, see the DEPLOYMENT section below or ask Claude Code:
> "Help me deploy this timetracker app to Railway so my engineers can access it online"

## Folder Structure
```
timetracker/
  package.json        ← root (run npm commands here)
  README.md
  server/
    index.js          ← Express API server (port 3001)
    db.js             ← SQLite database + schema
    middleware.js     ← JWT authentication
    package.json
    timetracker.db    ← database file (created on first run)
  client/
    src/              ← React frontend source
    public/
    package.json
```

## Tech Stack
- **Frontend:** React (mobile-friendly, works on phones)
- **Backend:** Node.js + Express
- **Database:** SQLite (no separate database server needed)
- **Auth:** JWT tokens

## Notes for Claude Code
If you open this project in Claude Code, you can say:
> "Finish building the remaining pages: Timesheets, Customers, Projects, Engineers, Invoices, and Reports. Then get the app running."

The foundation (auth, database, layout, dashboard) is already built.
