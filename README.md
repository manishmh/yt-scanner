# YT Scanner - YouTube Video Analysis System

An advanced, event-driven YouTube video analysis system designed to automatically detect Amazon gift coupons in videos through comprehensive multi-modal analysis.

## 🎯 Overview

YT Scanner is a sophisticated serverless architecture that monitors YouTube channels and analyzes videos for:

- **Monetary values** ($550-$1000) in thumbnails using OCR
- **14-digit gift codes** in video frames using pattern recognition
- **Behavioral cues** (laughter, specific gestures) using AI analysis
- **Transcript analysis** for suspicious keywords
- **Audio analysis** for laughter peaks and timing

## 🏗️ Architecture

### Event-Driven Design
- **YouTube Monitoring**: Detects new videos via YouTube Data API v3
- **Pub/Sub Processing**: Parallel video analysis using Google Cloud Pub/Sub
- **Queue Management**: Bull/Redis for job processing and rate limiting
- **Cloud Services**: Google Cloud Vision, Video Intelligence, Speech-to-Text

### Components
```
YouTube Monitor → Pub/Sub → Video Processor → Analysis Services
                     ↓
Database (MongoDB) ← Queue (Redis) ← Parallel Analysis:
                                     ├── Thumbnail OCR
                                     ├── Video Processing
                                     ├── Transcript Analysis
                                     └── Audio Analysis
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Google Cloud Project with APIs enabled
- YouTube Data API key
- MongoDB & Redis (or use Docker Compose)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd ytScanner
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment setup**
```bash
cp env.example .env
# Edit .env with your configuration
```

4. **Google Cloud setup**
```bash
# Place your GCP service account key
mkdir credentials
cp path/to/your/gcp-key.json credentials/gcp-key.json
```

5. **Start with Docker Compose**
```bash
# Basic setup
docker-compose up -d

# With management tools
docker-compose --profile tools up -d
```

6. **Development mode**
```bash
npm run dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_CLOUD_PROJECT_ID` | Your GCP project ID | Yes |
| `YOUTUBE_API_KEY` | YouTube Data API key | Yes |
| `YOUTUBE_CHANNEL_ID` | Target channel to monitor | Yes |
| `MONGODB_URI` | MongoDB connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `WEBHOOK_URL` | Notification webhook URL | No |

### Monetary Detection Settings
```env
MIN_DOLLAR_AMOUNT=550
MAX_DOLLAR_AMOUNT=1000
DOLLAR_AMOUNT_STEP=50
```

### Processing Configuration
```env
MAX_VIDEO_DURATION_MINUTES=120
FRAME_SAMPLING_INTERVAL_SECONDS=0.5
OCR_CONFIDENCE_THRESHOLD=0.8
```

## 📡 API Endpoints

### Health & Status
- `GET /health` - Health check
- `GET /api/status` - System status and statistics

### Analysis Results
- `GET /api/results` - Get analysis results (with filtering)
- `GET /api/results/:videoId` - Get specific video analysis
- `GET /api/statistics` - Get system statistics

### Processing
- `POST /api/process/:videoId` - Manually trigger video analysis
- `GET /api/jobs` - Get processing jobs status

### Management
- `POST /api/cleanup` - Cleanup old data

### Query Parameters for `/api/results`
```
?recommendedAction=investigate
&hasMoneyThumbnail=true
&codesFoundMin=1
&limit=20
&skip=0
&sortBy=processedAt
&sortOrder=desc
```

## 🔍 Analysis Pipeline

### Stage 1: Thumbnail Analysis (Fast Filter)
- Downloads and preprocesses thumbnail
- OCR using Google Cloud Vision API
- Detects monetary values ($550, $600, $650, etc.)
- **Skips** detailed analysis if no money detected

### Stage 2: Parallel Deep Analysis
When monetary values are found in thumbnails:

#### Video Analysis
- Extracts frames at configured intervals
- Detects 14-digit codes using regex patterns:
  - `XXX-XXXXXXX-XXXX`
  - `XXXX-XXXXXX-XXXX`
  - `14 consecutive characters`
- Behavioral analysis (laughter, looking down, gestures)

#### Transcript Analysis
- Fetches YouTube captions/subtitles
- Searches for suspicious keywords:
  - Gift-related: "gift card", "amazon gift", "coupon"
  - Money-related: "cash", "dollars", "free money"
  - Action-related: "redeem", "claim", "winner"

#### Audio Analysis
- Extracts audio from video
- Speech-to-text analysis for laughter detection
- Identifies suspicious audio segments
- Calculates laughter intensity and timing

### Stage 3: Results Compilation
- Confidence scoring based on multiple indicators
- Recommended actions: `investigate`, `monitor`, `ignore`
- Detailed analysis report with timestamps

## 🛠️ Development

### Project Structure
```
src/
├── config/           # Configuration management
├── types/            # TypeScript definitions
├── utils/            # Utilities (logging, etc.)
├── services/
│   ├── youtube/      # YouTube monitoring
│   ├── analysis/     # Analysis services
│   │   ├── thumbnail.ts
│   │   ├── video.ts
│   │   ├── transcript.ts
│   │   └── audio.ts
│   ├── processor/    # Main orchestrator
│   └── database/     # MongoDB operations
└── index.ts          # Application entry point
```

### Build & Run
```bash
# Development
npm run dev

# Build
npm run build

# Production
npm start

# Linting
npm run lint
npm run lint:fix

# Testing
npm test
```

### Docker Development
```bash
# Build image
npm run docker:build

# Run container
npm run docker:run
```

## 📊 Monitoring & Logging

### Structured Logging
- Component-specific loggers
- Performance metrics tracking
- Detection event logging
- Request/response logging

### Log Files
- `logs/yt-scanner.log` - Main application logs
- `logs/error.log` - Error-only logs
- `logs/requests.log` - HTTP request logs

### Monitoring Endpoints
- Health checks with dependency status
- Processing queue statistics
- Database connection monitoring
- Performance metrics

## 🔒 Security

### Authentication
- API key-based authentication for external services
- Webhook signature verification
- Rate limiting on API endpoints

### Data Protection
- Sensitive data masking in logs
- Secure credential storage
- Non-root Docker container execution

### Network Security
- CORS configuration
- Helmet.js security headers
- Input validation with Zod schemas

## 📈 Performance Optimization

### Parallel Processing
- Multiple analysis streams run concurrently
- Redis queue with priority handling
- Efficient frame sampling (0.5s intervals)

### Resource Management
- Video duration limits (120 minutes max)
- Automatic cleanup of temporary files
- Database result pagination
- Connection pooling

### Caching Strategy
- OCR confidence thresholds to reduce API calls
- Thumbnail pre-filtering to skip unnecessary processing
- Result caching for repeated queries

## 🚀 Deployment

### Production Deployment
1. **Google Cloud Platform Setup**
   - Enable required APIs (Vision, Video Intelligence, Speech-to-Text, Pub/Sub)
   - Create service account with necessary permissions
   - Set up Cloud Storage buckets

2. **Environment Configuration**
   - Production environment variables
   - Webhook endpoints for notifications
   - Monitoring and alerting setup

3. **Scaling Considerations**
   - Horizontal scaling with multiple instances
   - Redis cluster for high availability
   - MongoDB replica sets
   - Load balancing

### Cloud Deployment Options
- **Google Cloud Run** (serverless)
- **Kubernetes** (container orchestration)
- **Docker Swarm** (simple orchestration)
- **VM instances** (traditional deployment)

## 🧪 Testing

### Test Coverage
- Unit tests for analysis components
- Integration tests for API endpoints
- End-to-end testing for video processing pipeline

### Mock Services
- YouTube API mocking for development
- Google Cloud service mocking
- Database test fixtures

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards
- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- Conventional commit messages

## 📋 Troubleshooting

### Common Issues

**YouTube API Rate Limits**
- Check your API quota in Google Cloud Console
- Implement exponential backoff for failed requests

**Google Cloud Service Errors**
- Verify service account permissions
- Check API enablement status
- Monitor quota usage

**Processing Delays**
- Check Redis queue status via `/api/status`
- Monitor MongoDB connection health
- Review processing job logs

**Memory Issues**
- Adjust video duration limits
- Increase container memory allocation
- Monitor frame processing intervals

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Check processing queue
curl localhost:3000/api/status

# View recent jobs
curl localhost:3000/api/jobs?limit=10
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas

## 🏆 Acknowledgments

- Google Cloud Platform for AI/ML services
- YouTube Data API for video metadata
- FFmpeg for video processing capabilities
- Open source community for foundational libraries 