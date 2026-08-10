# Customer-Onboarding

## Overview

The `Customer-Onboarding` project is a comprehensive Node.js application designed to handle the customer onboarding process. Built with Express.js and TypeScript, it integrates with multiple third-party services such as AWS S3, Firebase, to provide a seamless and secure onboarding experience.

## Features

- **TypeScript Support**: Type-safe code with TypeScript to catch errors during development.
- **Express.js Framework**: Robust RESTful API built using Express.js.
- **AWS SDK**: Utilizes AWS SDK (v3) for interactions with AWS S3, including file uploads and signed URL generation.
- **Firebase Integration**: Secure API requests with Firebase Admin SDK.
- **Winston Logging**: Advanced logging with daily rotation for efficient log management.
- **Yup Validation**: Validates API request data using schema-based validation.
- **Multer Middleware**: Efficiently handles file uploads with restrictions on file size and type.

## Prerequisites

Before running the project, ensure that you have the following installed:

- **Node.js**: Version 16.x or later
- **npm**: Version 8.x or later
- **TypeScript**: Version 5.x or later

## Installation

Follow the steps below to set up the project:

**Install dependences**
`npm install`

**Start Dev Server**
`npm run dev`

**Build es2016 code**
`npm run build`
javascript build code will be generate in dist folder

**Start Server**
`npm run start`
to start dist/index.js
