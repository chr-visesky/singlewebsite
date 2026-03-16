using System;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using HomeworkApp.Models;
using HomeworkApp.Services;

namespace HomeworkApp.Views
{
    /// <summary>
    /// Print document for homework pages
    /// </summary>
    public class HomeworkPrintDocument
    {
        private readonly JobSession _job;
        private readonly DocumentService _documentService;

        public HomeworkPrintDocument(JobSession job, DocumentService documentService)
        {
            _job = job;
            _documentService = documentService;
        }

        public void Print(PrintQueue printQueue, PrintTicket? printTicket = null)
        {
            var printDialog = new PrintDialog();
            printDialog.PrintQueue = printQueue;
            printDialog.PrintTicket = printTicket ?? printQueue.UserPrintTicket ?? printQueue.DefaultPrintTicket;

            var pageSize = ResolvePrintableArea(printQueue, printDialog.PrintTicket, printDialog);

            // Print all pages
            for (int i = 0; i < _job.TotalPages; i++)
            {
                var page = GetPage(i, pageSize);
                if (page != null)
                {
                    printDialog.PrintVisual(page, $"Homework Page {i + 1}");
                }
            }
        }

        private static Size ResolvePrintableArea(PrintQueue printQueue, PrintTicket? printTicket, PrintDialog printDialog)
        {
            try
            {
                var capabilities = printQueue.GetPrintCapabilities(printTicket);
                var imageableArea = capabilities.PageImageableArea;

                if (imageableArea != null &&
                    imageableArea.ExtentWidth > 0 &&
                    imageableArea.ExtentHeight > 0)
                {
                    return new Size(imageableArea.ExtentWidth, imageableArea.ExtentHeight);
                }
            }
            catch
            {
            }

            if (printDialog.PrintableAreaWidth > 0 && printDialog.PrintableAreaHeight > 0)
            {
                return new Size(printDialog.PrintableAreaWidth, printDialog.PrintableAreaHeight);
            }

            return new Size(794, 1123);
        }

        private Visual GetPage(int pageNumber, Size pageSize)
        {
            try
            {
                var docPage = _documentService.GetPageAsync(pageNumber, pageSize.Width, pageSize.Height).Result;

                // Create visual for printing
                var mainVisual = new ContainerVisual();

                // Draw document image or blank page background
                var imageVisual = new DrawingVisual();
                using (var context = imageVisual.RenderOpen())
                {
                    context.DrawRectangle(Brushes.White, null, new Rect(0, 0, pageSize.Width, pageSize.Height));

                    if (docPage != null && docPage.Image != null)
                    {
                        context.DrawImage(docPage.Image, new Rect(0, 0, pageSize.Width, pageSize.Height));
                    }
                }
                mainVisual.Children.Add(imageVisual);

                // Load and draw ink
                string inkPath = _job.GetInkFilePath(pageNumber);
                var strokes = InkService.LoadInk(inkPath);

                if (strokes != null && strokes.Count > 0)
                {
                    // Calculate scale from logical to print coordinates
                    double baseWidth = docPage?.Width > 0 ? docPage.Width : pageSize.Width;
                    double baseHeight = docPage?.Height > 0 ? docPage.Height : pageSize.Height;
                    double scaleX = pageSize.Width / baseWidth;
                    double scaleY = pageSize.Height / baseHeight;

                    var inkVisual = InkService.CreateInkVisual(strokes, scaleX, scaleY);
                    mainVisual.Children.Add(inkVisual);
                }

                return mainVisual;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error getting print page {pageNumber}: {ex.Message}");
                return new DrawingVisual();
            }
        }
    }
}
