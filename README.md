# Qrave Backend API

Standalone Node.js/Express backend API server for the Qrave Restaurant Management System.

**Built with JavaScript (ES Modules)**

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the `backend/` directory:

```bash
# Server Configuration
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

# Database (when ready)
DATABASE_URL=postgresql://user:password@localhost:5432/qrave_db

# Session Secret (generate a random string in production)
SESSION_SECRET=your-session-secret-here-change-in-production
```

### 3. Run in Development

```bash
npm run dev
```

The server will start on `http://localhost:3001`

### 4. Build for Production

```bash
npm run build
```

### 5. Start Production Server

```bash
npm start
```

## API Endpoints

All API endpoints are prefixed with `/api`

### Health Check

- `GET /health` - Server health check

### Example Endpoints (to be implemented)

- `POST /api/auth/login` - User authentication
- `GET /api/restaurants/:id` - Get restaurant details
- `POST /api/menus` - Create menu
- `GET /api/menus/:slug` - Get public menu
- etc.

## Project Structure

```
backend/
├── src/
│   ├── index.js         # Express server entry point (JavaScript)
│   ├── routes.js        # API route registration (JavaScript)
│   └── storage.js       # Storage abstraction layer (JavaScript)
├── shared/
│   └── schema.ts        # Database schema definitions (TypeScript for Drizzle)
├── script/
│   └── build.js         # Build script (JavaScript)
├── package.json
├── tsconfig.json        # Only needed for Drizzle schema files
└── drizzle.config.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `HOST` | Server host | `0.0.0.0` |
| `NODE_ENV` | Environment mode | `development` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:5173` |
| `CORS_ORIGIN` | Alternative CORS origin | Same as FRONTEND_URL |
| `DATABASE_URL` | PostgreSQL connection string | Required for DB |
| `SESSION_SECRET` | Session encryption secret | Required in production |

## Scripts

- `npm run dev` - Start development server with hot reload (uses Node.js --watch)
- `npm run build` - Build for production (bundles with esbuild)
- `npm start` - Start production server (runs source files directly)
- `npm run db:push` - Push database schema changes
- `npm run db:generate` - Generate database migrations
- `npm run db:migrate` - Run database migrations

**Note:** The backend is written in JavaScript. The `shared/schema.ts` file remains TypeScript as it's used by Drizzle Kit for type-safe database schema definitions.

## CORS Configuration

The backend is configured to allow cross-origin requests from the frontend. 

**Development:** Allows `http://localhost:5173` by default

**Production:** Set `FRONTEND_URL` environment variable to your production frontend URL.

**Important:** Never use `"*"` as the CORS origin in production.

## Database

Currently using in-memory storage (`MemStorage`). 

To use PostgreSQL:

1. Set `DATABASE_URL` in `.env`
2. Update `storage.js` to use Drizzle ORM
3. Run migrations: `npm run db:push`

**Note:** While the backend code is JavaScript, the database schema (`shared/schema.ts`) is TypeScript. This is intentional as Drizzle Kit requires TypeScript for schema definitions. The compiled JavaScript code can still interact with the database using Drizzle ORM.

## Deployment

See `BACKEND_SEPARATION_GUIDE.md` in the root directory for detailed deployment instructions.

### Quick Deploy Options

**Heroku:**
```bash
heroku create qrave-backend
git subtree push --prefix backend heroku main
```

**Railway:**
- Connect GitHub repo
- Set root directory to `backend`
- Add environment variables

**Docker:**
```bash
cd backend
docker build -t qrave-backend .
docker run -p 3001:3001 qrave-backend
```

## Security Notes

- Always use HTTPS in production
- Set a strong `SESSION_SECRET`
- Never commit `.env` file
- Use environment-specific database credentials
- Implement rate limiting for production
- Use authentication middleware for protected routes
