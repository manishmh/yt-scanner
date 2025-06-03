# Database Setup Guide

## 🗄️ **Current Database Architecture**

The YT Scanner uses **two databases**:

1. **🔥 Google Firestore** - Primary database for storing video analysis results
2. **🔴 Redis** - Secondary database for caching and job queues

## 📋 **Required Environment Variables**

Create a `.env` file in the project root with these variables:

```bash
# ===========================================
# YOUTUBE API CONFIGURATION
# ===========================================
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CHANNEL_ID=UCoiH8oVL0mLvTtXwjAinR9g

# ===========================================
# GOOGLE CLOUD CONFIGURATION (FIRESTORE + VISION API)
# ===========================================
GOOGLE_CLOUD_PROJECT_ID=smart-glasses-447114
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=./credentials/gcp-service-account.json

# ===========================================
# REDIS DATABASE (FOR CACHING & QUEUES)
# ===========================================
REDIS_URL=redis://localhost:6379

# ===========================================
# WEBHOOK CONFIGURATION (PUBSUBHUBBUB)
# ===========================================
WEBHOOK_BASE_URL=http://localhost:3000
WEBHOOK_SECRET=your_webhook_secret_here

# ===========================================
# APPLICATION CONFIGURATION
# ===========================================
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

## 🔥 **Firestore Setup (Primary Database)**

### ✅ **Already Configured**
- **Project ID**: `smart-glasses-447114`
- **Credentials**: `./credentials/gcp-service-account.json`
- **Collections Used**:
  - `video_analysis_results` - Stores video analysis data
  - `processing_jobs` - Stores background job information
  - `file_storage` - Stores file metadata

### 🔧 **What You Need**
- ✅ **Google Cloud Project**: Already set up (`smart-glasses-447114`)
- ✅ **Service Account**: Already exists in `./credentials/gcp-service-account.json`
- ✅ **Firestore Database**: Already enabled and working
- ✅ **Vision API**: Already enabled and working

**No additional setup needed for Firestore!**

## 🔴 **Redis Setup (Secondary Database)**

### 🐳 **Option 1: Docker (Recommended)**
```bash
# Start Redis using Docker Compose
docker-compose up -d redis

# Verify it's running
docker-compose ps
```

### 📦 **Option 2: Local Installation**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install redis-server

# macOS
brew install redis

# Start Redis
redis-server

# Test connection
redis-cli ping
```

### ☁️ **Option 3: Cloud Redis**
Use a cloud Redis service like:
- **Redis Cloud** (free tier available)
- **AWS ElastiCache**
- **Google Cloud Memorystore**

Update the `REDIS_URL` in your `.env` file accordingly.

## 🚫 **Deprecated: Cloudflare D1**

The project **no longer uses Cloudflare D1**. It has been replaced with Firestore. These variables are optional:

```bash
# LEGACY - NOT REQUIRED ANYMORE
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here  
CLOUDFLARE_D1_DATABASE_ID=your_database_id_here
```

## 🧪 **Testing Database Connections**

### Test Firestore
```bash
# The application will log this on startup:
# "Firestore Database Service initialized"
# "Firestore collections ready for use"
```

### Test Redis
```bash
# Check if Redis is accessible
redis-cli ping
# Should return: PONG

# Or test via the application health endpoint
curl http://localhost:3000/health
```

## 📊 **Database Usage**

### **Firestore Collections**

1. **`video_analysis_results`**
   ```json
   {
     "videoId": "string",
     "processedAt": "timestamp",
     "thumbnailAnalysis": { "monetaryDetections": [...] },
     "summary": { "recommendedAction": "monitor|investigate|ignore" }
   }
   ```

2. **`processing_jobs`**
   ```json
   {
     "id": "string",
     "videoId": "string", 
     "status": "pending|processing|completed|failed",
     "type": "thumbnail|video|transcript|audio|full"
   }
   ```

### **Redis Usage**
- **Caching**: Video metadata, API responses
- **Job Queues**: Background processing tasks
- **Rate Limiting**: API request throttling

## 🔧 **Environment Setup Commands**

```bash
# 1. Copy the environment template
cp .env.example .env

# 2. Edit the .env file with your credentials
nano .env

# 3. Start Redis (if using Docker)
docker-compose up -d redis

# 4. Start the application
npm start
```

## 🚨 **Required Credentials Summary**

| Service | Status | Required |
|---------|--------|----------|
| **YouTube API Key** | ❌ Missing | ✅ Required |
| **Google Cloud Project** | ✅ Working | ✅ Required |
| **Firestore** | ✅ Working | ✅ Required |
| **Vision API** | ✅ Working | ✅ Required |
| **Redis** | ❓ Unknown | ✅ Required |
| **Cloudflare D1** | ❌ Deprecated | ❌ Not needed |

## 🎯 **Next Steps**

1. **Create `.env` file** with the variables above
2. **Get YouTube API Key** from Google Cloud Console
3. **Start Redis** using Docker or install locally
4. **Test the setup** by running `npm start`

The Firestore database is already fully configured and working! 