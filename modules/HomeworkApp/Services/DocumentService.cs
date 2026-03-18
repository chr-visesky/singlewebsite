using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;

namespace HomeworkApp.Services
{
    /// <summary>
    /// Document service with page caching (current, prev, next only)
    /// Supports images and single PDF documents
    /// </summary>
    public class DocumentService : IDisposable
    {
        private IDocumentProvider? _provider;
        private readonly Dictionary<int, DocumentPage> _cache = new();
        private int _lastRequestedPage = -1;
        private bool _disposed;

        public int PageCount => _provider?.PageCount ?? 0;

        public void LoadDocument(string filePath)
        {
            _provider?.Dispose();
            _cache.Clear();
            _lastRequestedPage = -1;

            string extension = Path.GetExtension(filePath).ToLowerInvariant();

            if (extension is ".jpg" or ".jpeg" or ".png" or ".bmp" or ".gif")
            {
                _provider = new ImageDocumentProvider(new List<string> { filePath });
            }
            else if (extension == ".pdf")
            {
                _provider = new PdfDocumentProvider(filePath);
            }
            else
            {
                throw new NotSupportedException($"Unsupported file type: {extension}. Supported types: PDF, JPG, PNG, BMP, GIF.");
            }
        }

        public void LoadMultipleImages(List<string> imagePaths)
        {
            _provider?.Dispose();
            _cache.Clear();
            _lastRequestedPage = -1;

            _provider = new ImageDocumentProvider(imagePaths);
        }

        public async Task<DocumentPage?> GetPageAsync(int pageIndex, double width, double height)
        {
            if (_provider == null || pageIndex < 0 || pageIndex >= PageCount)
            {
                return null;
            }

            // Return cached if available
            if (
                _cache.TryGetValue(pageIndex, out var cached) &&
                Math.Abs(cached.RenderWidth - width) < 1 &&
                Math.Abs(cached.RenderHeight - height) < 1
            )
            {
                _lastRequestedPage = pageIndex;
                return cached;
            }

            // Render the page
            var page = await _provider.RenderPageAsync(pageIndex, width, height).ConfigureAwait(false);
            if (page != null)
            {
                _cache[pageIndex] = page;
                _lastRequestedPage = pageIndex;

                // Clean up old cache entries (keep only current, prev, next)
                PruneCache();
            }

            return page;
        }

        public async Task<ImageSource?> GetThumbnailAsync(int pageIndex, int size)
        {
            if (_provider == null || pageIndex < 0 || pageIndex >= PageCount)
            {
                return null;
            }

            return await _provider.GetPageThumbnailAsync(pageIndex, size).ConfigureAwait(false);
        }

        private void PruneCache()
        {
            var keysToRemove = _cache.Keys
                .Where(k => k != _lastRequestedPage &&
                            k != _lastRequestedPage - 1 &&
                            k != _lastRequestedPage + 1)
                .ToList();

            foreach (var key in keysToRemove)
            {
                _cache.Remove(key);
            }
        }

        public double GetPageWidth(int pageIndex) => _provider?.GetPageWidth(pageIndex) ?? 0;
        public double GetPageHeight(int pageIndex) => _provider?.GetPageHeight(pageIndex) ?? 0;

        public void Dispose()
        {
            if (!_disposed)
            {
                _provider?.Dispose();
                _cache.Clear();
                _disposed = true;
            }
        }
    }
}
