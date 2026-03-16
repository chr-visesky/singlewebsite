namespace HomeworkApp.Models
{
    /// <summary>
    /// Represents the state of a single page including its ink data
    /// </summary>
    public class PageState
    {
        public int PageIndex { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public byte[]? InkData { get; set; }
        public bool HasInk => InkData != null && InkData.Length > 0;
    }
}
