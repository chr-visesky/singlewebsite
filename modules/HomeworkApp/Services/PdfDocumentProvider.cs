using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;
using PDFtoImage;
using SkiaSharp;

namespace HomeworkApp.Services
{
    /// <summary>
    /// PDF document provider backed by PDFtoImage/PDFium.
    /// Supports a single PDF file per homework job.
    /// </summary>
    public class PdfDocumentProvider : IDocumentProvider
    {
        private readonly byte[] _pdfBytes;
        private readonly List<PageSize> _pageSizes;
        private readonly string? _password;
        public int PageCount => _pageSizes.Count;

        public PdfDocumentProvider(string pdfPath, string? password = null)
        {
            if (string.IsNullOrWhiteSpace(pdfPath))
            {
                throw new ArgumentException("PDF path is required.", nameof(pdfPath));
            }

            if (!File.Exists(pdfPath))
            {
                throw new FileNotFoundException("PDF file was not found.", pdfPath);
            }

            _pdfBytes = File.ReadAllBytes(pdfPath);
            _password = password;
            _pageSizes = Conversion.GetPageSizes(_pdfBytes, _password)
                .Select(size => new PageSize(size.Width, size.Height))
                .ToList();
        }

        public async Task<DocumentPage?> RenderPageAsync(int pageIndex, double width, double height)
        {
            if (pageIndex < 0 || pageIndex >= _pageSizes.Count)
            {
                return null;
            }

            return await Task.Run(() =>
            {
                try
                {
                    var pageSize = _pageSizes[pageIndex];
                    var target = CalculateTargetSize(pageSize, width, height);

                    using var output = new MemoryStream();
                    Conversion.SavePng(
                        output,
                        _pdfBytes,
                        pageIndex,
                        _password,
                        new PDFtoImage.RenderOptions
                        {
                            Width = target.Width,
                            Height = target.Height,
                            WithAspectRatio = false,
                            BackgroundColor = SKColors.White,
                            UseTiling = true
                        });

                    output.Position = 0;

                    var bitmap = new BitmapImage();
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = output;
                    bitmap.EndInit();
                    bitmap.Freeze();

                    return new DocumentPage
                    {
                        PageIndex = pageIndex,
                        Image = bitmap,
                        Width = pageSize.Width,
                        Height = pageSize.Height,
                        RenderWidth = width,
                        RenderHeight = height
                    };
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error rendering PDF page {pageIndex}: {ex.Message}");
                    System.Diagnostics.Debug.WriteLine(ex.StackTrace);
                    return null;
                }
            }).ConfigureAwait(false);
        }

        public async Task<ImageSource?> GetPageThumbnailAsync(int pageIndex, int size)
        {
            var page = await RenderPageAsync(pageIndex, size, size);
            return page?.Image;
        }

        public double GetPageWidth(int pageIndex)
        {
            if (pageIndex < 0 || pageIndex >= _pageSizes.Count)
            {
                return 0;
            }

            return _pageSizes[pageIndex].Width;
        }

        public double GetPageHeight(int pageIndex)
        {
            if (pageIndex < 0 || pageIndex >= _pageSizes.Count)
            {
                return 0;
            }

            return _pageSizes[pageIndex].Height;
        }

        public void Dispose()
        {
        }

        private static RenderSize CalculateTargetSize(PageSize pageSize, double width, double height)
        {
            double safeWidth = width > 0 ? width : pageSize.Width;
            double safeHeight = height > 0 ? height : pageSize.Height;

            double scaleX = safeWidth / pageSize.Width;
            double scaleY = safeHeight / pageSize.Height;
            double scale = Math.Min(scaleX, scaleY);

            if (double.IsNaN(scale) || double.IsInfinity(scale) || scale <= 0)
            {
                scale = 1;
            }

            return new RenderSize(
                Math.Max(1, (int)Math.Round(pageSize.Width * scale)),
                Math.Max(1, (int)Math.Round(pageSize.Height * scale)));
        }

        private readonly record struct PageSize(double Width, double Height);

        private readonly record struct RenderSize(int Width, int Height);
    }
}
