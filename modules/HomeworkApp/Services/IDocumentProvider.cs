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
    /// Interface for document providers (PDF, Image, etc.)
    /// </summary>
    public interface IDocumentProvider : IDisposable
    {
        int PageCount { get; }

        Task<DocumentPage?> RenderPageAsync(int pageIndex, double width, double height);

        Task<ImageSource?> GetPageThumbnailAsync(int pageIndex, int size);

        double GetPageWidth(int pageIndex);

        double GetPageHeight(int pageIndex);
    }

    /// <summary>
    /// Image-only document provider - supports single or multiple images as pages
    /// </summary>
    public class ImageDocumentProvider : IDocumentProvider
    {
        private readonly List<string> _imagePaths;
        private readonly Dictionary<int, ImageSize> _cache = new();
        private bool _disposed;

        public int PageCount => _imagePaths.Count;

        public ImageDocumentProvider(List<string> imagePaths)
        {
            _imagePaths = new List<string>(imagePaths);
        }

        public async Task<DocumentPage?> RenderPageAsync(int pageIndex, double width, double height)
        {
            if (pageIndex < 0 || pageIndex >= _imagePaths.Count)
            {
                return null;
            }

            return await Task.Run(() =>
            {
                try
                {
                    var imagePath = _imagePaths[pageIndex];

                    // Ensure path is absolute
                    if (!Path.IsPathRooted(imagePath))
                    {
                        imagePath = Path.GetFullPath(imagePath);
                    }

                    // Load image with proper decode size for memory efficiency
                    var bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.UriSource = new Uri(imagePath, UriKind.Absolute);
                    bmp.CacheOption = BitmapCacheOption.OnLoad;

                    // Get original image size
                    var size = GetImageSize(imagePath);

                    // Calculate scale to fit within target bounds while preserving aspect ratio
                    // This ensures the entire image is visible (no cropping)
                    double scaleX = width / size.Width;
                    double scaleY = height / size.Height;
                    double scale = Math.Min(scaleX, scaleY);

                    // Decode at scaled size for memory efficiency
                    int decodeWidth = (int)Math.Max(1, size.Width * scale);
                    int decodeHeight = (int)Math.Max(1, size.Height * scale);

                    bmp.DecodePixelWidth = decodeWidth;
                    bmp.DecodePixelHeight = decodeHeight;

                    bmp.EndInit();
                    bmp.Freeze();

                    return new DocumentPage
                    {
                        PageIndex = pageIndex,
                        Image = bmp,
                        Width = size.Width,
                        Height = size.Height,
                        RenderWidth = width,
                        RenderHeight = height
                    };
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error rendering image page {pageIndex}: {ex.Message}");
                    System.Diagnostics.Debug.WriteLine(ex.StackTrace);
                    return null;
                }
            }).ConfigureAwait(false);
        }

        public async Task<ImageSource?> GetPageThumbnailAsync(int pageIndex, int size)
        {
            if (pageIndex < 0 || pageIndex >= _imagePaths.Count)
            {
                return null;
            }

            return await Task.Run(() =>
            {
                try
                {
                    var imagePath = _imagePaths[pageIndex];

                    // Ensure path is absolute
                    if (!Path.IsPathRooted(imagePath))
                    {
                        imagePath = Path.GetFullPath(imagePath);
                    }

                    var bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.UriSource = new Uri(imagePath, UriKind.Absolute);
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.DecodePixelWidth = size;
                    bmp.EndInit();
                    bmp.Freeze();

                    return bmp;
                }
                catch
                {
                    return null;
                }
            }).ConfigureAwait(false);
        }

        public double GetPageWidth(int pageIndex)
        {
            if (pageIndex < 0 || pageIndex >= _imagePaths.Count)
                return 0;

            var size = GetImageSize(_imagePaths[pageIndex]);
            return size.Width;
        }

        public double GetPageHeight(int pageIndex)
        {
            if (pageIndex < 0 || pageIndex >= _imagePaths.Count)
                return 0;

            var size = GetImageSize(_imagePaths[pageIndex]);
            return size.Height;
        }

        private ImageSize GetImageSize(string path)
        {
            if (_cache.TryGetValue(path.GetHashCode(), out var cached))
            {
                return cached;
            }

            // Ensure path is absolute
            if (!Path.IsPathRooted(path))
            {
                path = Path.GetFullPath(path);
            }

            try
            {
                var decoder = BitmapDecoder.Create(
                    new Uri(path, UriKind.Absolute),
                    BitmapCreateOptions.DelayCreation,
                    BitmapCacheOption.None);

                var frame = decoder.Frames[0];
                var size = new ImageSize(frame.PixelWidth, frame.PixelHeight);
                _cache[path.GetHashCode()] = size;
                return size;
            }
            catch
            {
                return new ImageSize(800, 600);
            }
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _cache.Clear();
                _disposed = true;
            }
        }

        private struct ImageSize
        {
            public double Width { get; }
            public double Height { get; }

            public ImageSize(double width, double height)
            {
                Width = width;
                Height = height;
            }
        }
    }
}
