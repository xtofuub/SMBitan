<div align="center">

# 📁 SMB Enumerator

**A modern, dark-themed network file browser and previewer**

Browse, search, and preview files on Windows network shares — right from your browser.

[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-2.x-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

</div>
<img width="1695" height="962" alt="image" src="https://github.com/user-attachments/assets/d69d05c4-0b26-48af-a34c-46276b9bc263" />

---

## 🔍 What is this?

**SMB Enumerator** is a lightweight, self-hosted web application that lets you browse and interact with files on Windows network shares (UNC paths) through a clean, professional dark-themed interface. Think of it as a modern file explorer that runs in your browser.

No complicated setup. No heavy dependencies. Just connect to a UNC path and start browsing.

---

## ✨ Features

### 📂 File Explorer
- **Tree-based navigation** — Expand and collapse folders just like a desktop file explorer
- **UNC path support** — Connect directly to Windows network shares (e.g. `\\server\share`)
- **Auto-connect** — Pre-configured path loads automatically on startup
- **Breadcrumb navigation** — Always know where you are in the file tree

### 🔎 Instant Search
- **Background indexing** — Entire file tree is indexed in-memory for near-instant search
- **Disk cache** — Index is saved to disk so reconnections are lightning-fast (24h TTL)
- **Smart filters** — Search by name or full path, filter by files/folders, toggle exact word match
- **Click to preview** — Search results open file previews directly; use the 📂 button to locate in tree

### 👁️ File Preview
- **Images** — PNG, JPG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF rendered inline
- **PDF documents** — Full page-by-page viewer with navigation arrows (powered by PDF.js)
- **Word documents** — `.docx` files rendered as formatted HTML (powered by mammoth.js)
- **Text & code** — Syntax-friendly display for `.txt`, `.json`, `.py`, `.js`, `.csv`, `.xml`, `.md`, `.yaml`, and many more
- **Open in Browser** — Open any file directly in a new browser tab
- **Download** — One-click download for any file

### 🎨 Interface
- **Dark theme** — Easy on the eyes, inspired by GitHub's dark mode
- **Animated transitions** — Smooth expand/collapse with staggered fade-in animations
- **File icons** — Visual file type indicators at a glance
- **Responsive layout** — Sidebar explorer + main preview pane

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.8+** installed on your machine
- **Network access** to the target UNC share (e.g. `\\10.0.0.5\share`)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/smb-enumerator.git
cd smb-enumerator

# Create a virtual environment
python -m venv .venv

# Activate it
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# Install dependencies
pip install -r requirements.txt
```

### Run

```bash
python app.py
```

Open **http://localhost:5000** in your browser. That's it.

---

## 🖥️ Usage

| Step | Action |
|------|--------|
| **1** | Enter a UNC path in the top bar (e.g. `\\10.0.0.5\Tekniikka`) |
| **2** | Make sure the **UNC** checkbox is enabled |
| **3** | Click **Connect** |
| **4** | Browse the file tree in the sidebar, or type in the search bar |
| **5** | Click any file to preview it in the viewer pane |

### Search Tips

- Type in the search bar to instantly search across **all** folders (even those not yet expanded)
- Use the filter buttons to narrow results:
  - **Name** / **Path** — match against file name only, or the full path
  - **All** / **Files** / **Folders** — filter by entry type
  - **Exact** — match whole words only
- Click a search result to **preview** it directly
- Click the **📂** button on a result to **navigate** to its location in the tree

---

## 📁 Project Structure

```
smb-enumerator/
├── app.py              # Flask backend — API endpoints, indexer, disk cache
├── requirements.txt    # Python dependencies (flask, pysmb)
├── README.md
└── static/
    ├── index.html      # Main page layout
    ├── style.css       # Dark theme styles
    └── app.js          # Frontend logic — tree, search, preview, PDF viewer
```

---

## ⚙️ API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shares` | GET | List available shares (or synthetic share for UNC) |
| `/api/list` | GET | List directory contents |
| `/api/file` | GET | Serve a file for preview or download |
| `/api/search` | GET | Search indexed files with filters |
| `/api/index` | POST | Trigger background indexing |
| `/api/index/status` | GET | Poll indexing progress |
| `/api/index/clear` | POST | Clear disk cache and re-index |

---

## ⚠️ Disclaimer

> **This tool is intended for use on systems and network shares you are authorized to access.**
> The author is not responsible for any misuse. Always ensure you have proper permissions before connecting to network resources.

---

<div align="center">

Built with ❤️ using Flask, PDF.js & mammoth.js

</div>

