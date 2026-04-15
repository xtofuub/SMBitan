# 📁 SMB Enumerator

A web-based browser for Windows network shares with file search and previews.

Browse, search, and open files on SMB/UNC paths from your browser through a clean interface.

---

## Overview

**SMB Enumerator** is a lightweight self-hosted application for accessing files stored on Windows network shares. It provides a browser-based file explorer with search, previews, and downloads, making it easier to work with shared files without opening the native file explorer.

Connect to a UNC path such as `\\server\share`, browse folders, search indexed content, and preview supported files directly in the app.

---

## Features

## File Browsing

* Folder tree navigation with expandable directories
* Direct support for UNC paths (for example `\\server\share`)
* Breadcrumb path navigation
* Optional auto-connect to a predefined share

## Search

* In-memory indexing for fast searches
* Optional disk cache for faster reconnects
* Search by file name or full path
* Filter by files or folders
* Exact match option

## File Preview

Supports common file types directly in the browser:

* **Images:** PNG, JPG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF
* **PDF:** Multi-page viewer using PDF.js
* **DOCX:** Rendered HTML view using mammoth.js
* **Text / Code:** TXT, JSON, PY, JS, CSV, XML, MD, YAML and others

Additional actions:

* Open file in a new tab
* Download files directly

## Interface

* Dark theme
* Responsive two-panel layout
* File type icons
* Smooth folder expansion and navigation

---

## Requirements

* Python 3.8 or newer
* Network access to the target SMB share
* Permission to access the target path

---

## Installation

```bash
git clone https://github.com/xtofuub/SMBitan.git
cd smb-enumerator

python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

---

## Running the Application

```bash
python app.py
```

Then open:

```text
http://localhost:5000
```

---

## Usage

1. Enter a UNC path such as `\\10.0.0.5\Share`
2. Enable UNC mode if required
3. Select **Connect**
4. Browse folders or use search
5. Select a file to preview or download

---

## Search Options

* **Name** — Search by file name only
* **Path** — Search full path
* **Files** — Show files only
* **Folders** — Show folders only
* **Exact** — Whole-word matching

---

## Project Structure

```text
smb-enumerator/
├── app.py
├── requirements.txt
├── README.md
└── static/
    ├── index.html
    ├── style.css
    └── app.js
```

---

## API Endpoints

| Endpoint            | Method | Purpose                       |
| ------------------- | ------ | ----------------------------- |
| `/api/shares`       | GET    | List shares                   |
| `/api/list`         | GET    | List directory contents       |
| `/api/file`         | GET    | Open or download a file       |
| `/api/search`       | GET    | Search indexed entries        |
| `/api/index`        | POST   | Start indexing                |
| `/api/index/status` | GET    | Check indexing progress       |
| `/api/index/clear`  | POST   | Clear cache and rebuild index |

---

## Security Notice

Use this tool only on systems and shares you are authorized to access. Ensure permissions are in place before connecting to network resources.

---

Built with Flask, PDF.js, and mammoth.js
