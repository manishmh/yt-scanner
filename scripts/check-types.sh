#!/bin/bash

# YT Scanner - Type and Error Checking Script
# This script checks for TypeScript compilation errors, linting issues, and dependency problems

set -e

echo "🔍 YT Scanner - Type & Error Checking Script"
echo "============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_error "node_modules not found. Please run 'npm install' first."
    exit 1
fi

print_status "Starting comprehensive type and error checking..."

# 1. Check for missing dependencies
print_status "1. Checking for missing dependencies..."
MISSING_DEPS=0

# Check if critical dependencies are installed
CRITICAL_DEPS=("typescript" "@types/node" "dotenv" "zod" "express" "mongoose")

for dep in "${CRITICAL_DEPS[@]}"; do
    if [ ! -d "node_modules/$dep" ]; then
        print_error "Missing dependency: $dep"
        MISSING_DEPS=1
    fi
done

if [ $MISSING_DEPS -eq 0 ]; then
    print_success "All critical dependencies are installed"
else
    print_error "Some dependencies are missing. Run 'npm install' to fix."
fi

# 2. Check TypeScript configuration
print_status "2. Checking TypeScript configuration..."
if [ -f "tsconfig.json" ]; then
    print_success "tsconfig.json found"
    
    # Validate tsconfig.json syntax
    if npx tsc --noEmit --skipLibCheck --project tsconfig.json 2>/dev/null; then
        print_success "tsconfig.json is valid"
    else
        print_warning "tsconfig.json may have issues"
    fi
else
    print_error "tsconfig.json not found"
fi

# 3. Check source file structure
print_status "3. Checking source file structure..."
REQUIRED_DIRS=("src" "src/config" "src/types" "src/services" "src/utils")
MISSING_DIRS=0

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        print_error "Missing directory: $dir"
        MISSING_DIRS=1
    fi
done

if [ $MISSING_DIRS -eq 0 ]; then
    print_success "All required directories exist"
fi

# 4. Check for TypeScript compilation errors
print_status "4. Running TypeScript compiler check..."
if npx tsc --noEmit --skipLibCheck; then
    print_success "TypeScript compilation check passed"
else
    print_error "TypeScript compilation errors found"
fi

# 5. Run ESLint if available
print_status "5. Running ESLint check..."
if [ -f "node_modules/.bin/eslint" ]; then
    if npx eslint src/**/*.ts --max-warnings 0; then
        print_success "ESLint check passed"
    else
        print_warning "ESLint found issues (see above)"
    fi
else
    print_warning "ESLint not available, skipping lint check"
fi

# 6. Check environment configuration
print_status "6. Checking environment configuration..."
if [ -f ".env" ]; then
    print_success ".env file found"
    
    # Check for required environment variables
    REQUIRED_ENV_VARS=("GOOGLE_CLOUD_PROJECT_ID" "YOUTUBE_API_KEY" "YOUTUBE_CHANNEL_ID")
    MISSING_ENV=0
    
    for var in "${REQUIRED_ENV_VARS[@]}"; do
        if ! grep -q "^$var=" .env 2>/dev/null; then
            print_error "Missing environment variable: $var"
            MISSING_ENV=1
        fi
    done
    
    if [ $MISSING_ENV -eq 0 ]; then
        print_success "All required environment variables are configured"
    fi
else
    print_warning ".env file not found. Copy env.example to .env and configure it."
fi

# 7. Check Docker configuration
print_status "7. Checking Docker configuration..."
DOCKER_FILES=("Dockerfile" "docker-compose.yml")
DOCKER_OK=0

for file in "${DOCKER_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_success "$file found"
        DOCKER_OK=1
    else
        print_warning "$file not found"
    fi
done

if [ $DOCKER_OK -eq 1 ]; then
    # Validate docker-compose.yml syntax
    if command -v docker-compose >/dev/null 2>&1; then
        if docker-compose config >/dev/null 2>&1; then
            print_success "docker-compose.yml is valid"
        else
            print_warning "docker-compose.yml has syntax issues"
        fi
    fi
fi

# 8. Check for common file issues
print_status "8. Checking for common file issues..."

# Check for files with Windows line endings
if command -v dos2unix >/dev/null 2>&1; then
    WINDOWS_FILES=$(find src -name "*.ts" -exec file {} \; | grep CRLF | wc -l)
    if [ $WINDOWS_FILES -gt 0 ]; then
        print_warning "$WINDOWS_FILES files have Windows line endings (CRLF)"
        print_status "Run: find src -name '*.ts' -exec dos2unix {} \;"
    fi
fi

# Check for very large files
LARGE_FILES=$(find src -name "*.ts" -size +100k)
if [ -n "$LARGE_FILES" ]; then
    print_warning "Large files found (>100KB):"
    echo "$LARGE_FILES"
fi

# 9. Test build process
print_status "9. Testing build process..."
if npm run build >/dev/null 2>&1; then
    print_success "Build process completed successfully"
    
    # Check if dist directory was created
    if [ -d "dist" ]; then
        print_success "Output directory 'dist' created"
        
        # Check if main files exist
        if [ -f "dist/index.js" ]; then
            print_success "Main entry point compiled successfully"
        else
            print_warning "Main entry point not found in dist/"
        fi
    fi
else
    print_error "Build process failed"
fi

# 10. Final summary
echo ""
echo "============================================="
print_status "Type checking complete!"

# Provide recommendations
echo ""
echo "🔧 Recommendations:"
echo "-------------------"

if [ $MISSING_DEPS -eq 1 ]; then
    echo "1. Install missing dependencies: npm install"
fi

if [ ! -f ".env" ]; then
    echo "2. Create environment file: cp env.example .env"
fi

echo "3. To fix TypeScript errors: npm run lint:fix"
echo "4. To start development: npm run dev"
echo "5. To build for production: npm run build"
echo "6. To run with Docker: docker-compose up -d"

echo ""
print_success "Script completed!" 