# CLAUDE CODE PROMPT — Paste this into Claude Code to finish the app

Open the timetracker folder in Claude Code, then paste this:

---

I have a partially built full-stack TimeTracker app in this folder. The foundation is already built:
- ✅ Server: Express + SQLite with all API routes (auth, users, customers, projects, timesheets, invoices, reports)
- ✅ Frontend: React with Login, Dashboard, Layout/Sidebar, AuthContext, CSS styles
- ❌ Missing frontend pages: Timesheets, Customers, Projects, Engineers, Invoices, Reports

Please finish building the app by creating these missing React pages in client/src/pages/:

**Timesheets.js** — List all timesheets with filters (status, project, engineer for admin). Button to create new timesheet (pick project + week-ending Sunday). Click a timesheet to open the entry screen showing Mon-Sun with start time, end time (hours auto-calc), shift #, and description per day. Submit button. Admin can approve/reject. Print button that generates a formatted print view matching this layout:
- Header: "Daily Time Report" title, Week Ending date top right, Engineer name, Work Order #, Project Name, Company name, Location
- Each day: date, start time, end time, hours, shift number
- Below each day: "Detailed Description of Work:" + the notes text  
- Weekly totals row
- Signature lines: "Certified correct by: ___" and "Approved by: ___" with date fields
- Expenses section (Air, Car/Taxi, Mileage, Lodging, Meals, Parking, On Call, Misc, Subtotal)
- Labor subtotal = hours × bill rate
- Grand total

**Customers.js** — Table of all customers with add/edit/delete. Modal form with fields: name, contact person, email, phone, address.

**Projects.js** — Table of all projects showing customer name, PO number, PO amount, status, amount billed, budget remaining with progress bar. Add/edit/delete. Modal form: customer (dropdown), project name, PO number, PO amount, location, status. Separate section to assign engineers to the project with their pay rate and bill rate.

**Engineers.js** — Table of all engineer accounts (users with role=engineer). Add/edit/delete. Modal form: name, email, password, engineer ID. Show which projects each engineer is assigned to.

**Invoices.js** — List of generated invoices. Button to generate new invoice: pick project, date range, pulls all approved timesheets in that range. Shows line items per engineer (hours × bill rate). Printable invoice with company header, customer info, PO number, line items, total. 

**Reports.js** — Two report tabs:
1. Payroll Report: pick date range → table showing each engineer, each project, hours worked, pay rate, total pay owed
2. Project Budget Report: all projects with PO amount, total billed, remaining, % used

Also create **client/src/components/Modal.js** — a reusable modal component used by the pages above.

Also create **client/src/index.js** and **client/src/App.js** to wire everything together.

After building all pages, run npm run install:all then npm run dev and confirm it works.

The API base URL is http://localhost:3001/api — the client package.json already has proxy set.
All API calls use the apiFetch() helper in client/src/api.js which handles JWT auth headers automatically.
