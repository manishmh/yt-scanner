# 🔑 Credentials Setup Guide

## Required Credentials Before Running the Application

Before you can monitor the YouTube channel `@manishmalhotra8099`, you need to set up the following credentials:

### 1. **YouTube Data API v3 Key** (REQUIRED)
**What it's for**: Monitoring YouTube channels for new videos

**How to get it**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **YouTube Data API v3**
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy the API key

**Add to `.env`**:
```env
YOUTUBE_API_KEY=your_youtube_api_key_here
```

### 2. **YouTube Channel ID** (REQUIRED)
**What it's for**: Specifying which channel to monitor

**How to get the Channel ID for @manishmalhotra8099**:

**Method 1 - Using our tool**:
1. Visit: https://www.tunepocket.com/youtube-channel-id-finder/
2. Enter: `@manishmalhotra8099` or `https://www.youtube.com/@manishmalhotra8099`
3. Copy the Channel ID (starts with `UC`)

**Method 2 - Manual**:
1. Go to: https://www.youtube.com/@manishmalhotra8099
2. View page source (Ctrl+U)
3. Search for `"channelId"` 
4. Copy the ID (starts with `UC`)

**Add to `.env`**:
```env
YOUTUBE_CHANNEL_ID=UC_the_channel_id_here
```

### 3. **Google Cloud Project ID** (REQUIRED)
**What it's for**: Google Cloud services (Vision AI, Pub/Sub, etc.)

**How to get it**:
1. In Google Cloud Console, note your Project ID
2. It's shown at the top of the console

**Add to `.env`**:
```env
GOOGLE_CLOUD_PROJECT_ID=your-project-id
```



### 4. **Google Cloud Service Account** (CONFIGURED ✅)
**What it's for**: Advanced analysis features (Vision AI for dollar detection in thumbnails)

**✅ ALREADY CONFIGURED**:
- Project: `smart-glasses-447114`
- Service Account: `yt-scanner-vision@smart-glasses-447114.iam.gserviceaccount.com`
- Credentials: `credentials/gcp-service-account.json`
- Vision API: Enabled

**Add to `.env`**:
```env
GOOGLE_APPLICATION_CREDENTIALS=credentials/gcp-service-account.json
GOOGLE_CLOUD_PROJECT_ID=smart-glasses-447114
```

### 5. **Cloudflare D1 Database** (REQUIRED)
**What it's for**: Storing analysis results and video metadata

**How to set up**:
1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up)
2. Go to **Workers & Pages** → **D1 SQL Database**
3. Click **Create Database**
4. Name it: `yt-scanner-db`
5. Note the **Database ID**

**Get API Token**:
1. Go to **My Profile** → **API Tokens**
2. Click **Create Token**
3. Use **Custom Token** template
4. Set permissions:
   - `Cloudflare D1:Edit` for your account
5. Copy the API token

**Get Account ID**:
1. Go to the Cloudflare dashboard
2. On the right sidebar, copy your **Account ID**

**Add to `.env`**:
```env
CLOUDFLARE_API_TOKEN=your_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_D1_DATABASE_ID=your_database_id_here
```

### 6. **Redis Connection** (REQUIRED)
**What it's for**: Job queue management

**Options**:

**Option A - Local Redis (Recommended for testing)**:
```env
REDIS_URL=redis://localhost:6379
```

**Option B - Redis Cloud**:
1. Create account at [Redis Cloud](https://redis.com/try-free/)
2. Get connection URL
```env
REDIS_URL=redis://username:password@host:port
```

## 📋 Complete .env File Template

Copy this to your `.env` file and fill in the values:

```env
# ===========================================
# YOUTUBE MONITORING CONFIGURATION
# ===========================================
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CHANNEL_ID=UC_channel_id_for_manishmalhotra8099
YOUTUBE_POLLING_INTERVAL_MINUTES=5



# ===========================================
# GOOGLE CLOUD CONFIGURATION (CONFIGURED ✅)
# ===========================================
GOOGLE_CLOUD_PROJECT_ID=smart-glasses-447114
GOOGLE_APPLICATION_CREDENTIALS=credentials/gcp-service-account.json

# ===========================================
# DATABASE CONFIGURATION
# ===========================================
# Cloudflare D1 Database
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_D1_DATABASE_ID=your_d1_database_id

# Redis (for job queue)
REDIS_URL=redis://localhost:6379

# ===========================================
# PROCESSING CONFIGURATION
# ===========================================
# Monetary values to detect in thumbnails ($550-$1000)
MONETARY_DETECTION_MIN=550
MONETARY_DETECTION_MAX=1000

# Video processing limits
MAX_VIDEO_DURATION_MINUTES=30
FRAME_SAMPLING_INTERVAL_SECONDS=10

# ===========================================
# AWS S3 STORAGE CONFIGURATION
# ===========================================
AWS_S3_BUCKET_VIDEOS=yt-scanner-videos
AWS_S3_BUCKET_THUMBNAILS=yt-scanner-thumbnails
AWS_S3_BUCKET_RESULTS=yt-scanner-results

# ===========================================
# PUB/SUB CONFIGURATION (OPTIONAL)
# ===========================================
PUBSUB_TOPIC_NEW_VIDEOS=new-videos
PUBSUB_SUBSCRIPTION_VIDEO_PROCESSOR=video-processor

# ===========================================
# WEBHOOK NOTIFICATIONS (OPTIONAL)
# ===========================================
WEBHOOK_URL=https://your-webhook-url.com/notify

# ===========================================
# APPLICATION CONFIGURATION
# ===========================================
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

## 🚀 Quick Start Steps

### 1. **Get YouTube Channel ID First**
```bash
# Visit this URL to get the channel ID:
# https://www.tunepocket.com/youtube-channel-id-finder/
# Enter: @manishmalhotra8099
```

### 2. **Set up AWS S3**
```bash
# 1. Create AWS Account
# 2. Create IAM user with S3 permissions
# 3. Generate access keys
# 4. Add credentials to .env file
```

### 3. **Start Local Services (Docker)**
```bash
# Start Redis (only need Redis now, D1 is cloud-hosted)
docker-compose up -d redis

# Verify it's running
docker-compose ps
```

### 4. **Configure Environment**
```bash
# Copy and edit the .env file
cp env.example .env
# Edit .env with your credentials
```

### 5. **Test the Setup**
```bash
# Test Cloudflare D1 connection
npm run test:d1

# Test AWS S3 connection
npm run test:aws

# Run type checking
npm run check-all

# Start the application
npm run dev

# Test the health endpoint
curl http://localhost:3000/health
```

## 🔍 Testing Channel Monitoring

Once configured, you can test monitoring the channel:

```bash
# Check if the channel is accessible
curl "http://localhost:3000/api/status"

# Manually trigger a check (if implemented)
curl -X POST "http://localhost:3000/api/check-channel"
```

## ⚠️ Important Notes

1. **YouTube API Quotas**: YouTube Data API has daily quotas. Monitor your usage.

2. **Google Cloud Costs**: Vision AI and Video Intelligence APIs have usage costs.

3. **Channel Privacy**: Ensure the target channel is public.

4. **Rate Limiting**: The system respects YouTube's rate limits.

5. **Storage**: Video analysis requires temporary storage space.

## 🆘 Troubleshooting

### Common Issues:

**"Channel not found"**:
- Verify the channel ID is correct
- Check if the channel is public
- Ensure YouTube API key is valid

**"Google Cloud authentication failed"**:
- Verify service account JSON file path
- Check if required APIs are enabled
- Ensure service account has proper roles

**"Database connection failed"**:
- Verify Cloudflare D1 credentials are correct
- Check Redis is running locally
- Test D1 connection with `npm run test:d1`
- Ensure network connectivity to Cloudflare

## 📞 Need Help?

If you encounter issues:
1. Check the logs: `tail -f logs/app.log`
2. Verify all credentials are correct
3. Test individual components
4. Check the troubleshooting section in SETUP.md 