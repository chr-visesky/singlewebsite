# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
cd Q:\homework\HomeworkApp
dotnet restore
dotnet build
dotnet run
```

## Project Structure

- **Models/** - Data models (`JobSession`, `PageState`, `DocumentPage`)
- **Services/** - Business logic layer
  - `IDocumentProvider` - Document provider interface
  - `ImageDocumentProvider` - Image file rendering (JPG/PNG/BMP/GIF)
  - `InkManager` - InkCanvas management with One Euro Filter for real-time stylus input smoothing
  - `OneEuroFilter` - Real-time jitter reduction optimized for Chinese handwriting
  - `SmoothStylusPlugIn` - Legacy stylus plugin (deprecated, use InkManager instead)
- **Views/** - WPF pages (`MainWindow`, `HomePage`, `SubjectPage`, `ImportPage`, `EditorPage`, `HistoryPage`, `SettingsPage`)
- `JobManager.cs` - Job session CRUD and history management

## Architecture

**Tech Stack**: C# / .NET 10 / WPF

**Key Design Decisions**:
- Document/Ink layer separation - `InkCanvas` overlays document image, never baked into bitmap
- Logical coordinate system for ink strokes - enables proper scaling and print output
- One Euro Filter for real-time stylus smoothing with speed-adaptive cutoff (preserves Chinese character strokes like 横折、竖钩、撇捺)
- PreviewStylusDown/Move/Up event handlers for real-time ink filtering (StylusPlugIn API is internal)
- 3-page cache strategy (current/prev/next) for memory efficiency
- Debounced auto-save (2s delay after ink changes)
- Job-based data organization: `AppData/HomeworkApp/Jobs/{jobId}/`
- Image-only document support in initial version (PDF support deferred)

**Data Flow**:
1. Import creates `JobSession` → copies source files to job directory
2. `DocumentService` loads images (JPG/PNG/BMP/GIF)
3. `InkManager` handles stroke input/transformation with One Euro Filter
4. Ink saved per-page to `.ink` files (WPF StrokeCollection format)
5. Print composites document + ink at print resolution

**A4 Paper Dimensions**:
- Portrait: 210×297mm @ 96 DPI = 794×1123 pixels (logical)
- Landscape: 297×210mm @ 96 DPI = 1123×794 pixels (logical)

## Commands

| Command | Description |
|---------|-------------|
| `dotnet run` | Launch application |
| `dotnet build` | Build project |
| `dotnet clean` | Clean build artifacts |

## Dependencies

- **Newtonsoft.Json** - Job metadata serialization
