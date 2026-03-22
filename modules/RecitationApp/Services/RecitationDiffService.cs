using System.Text;
using DiffPlex;
using DiffPlex.DiffBuilder;
using DiffPlex.DiffBuilder.Model;

namespace RecitationApp.Services;

public sealed class RecitationDiffService
{
    public string BuildSummary(string sourceText, string transcript)
    {
        var diff = new InlineDiffBuilder(new Differ()).BuildDiffModel(sourceText ?? string.Empty, transcript ?? string.Empty);
        var builder = new StringBuilder();

        foreach (DiffPiece line in diff.Lines)
        {
            string prefix = line.Type switch
            {
                ChangeType.Inserted => "[多背]",
                ChangeType.Deleted => "[漏背]",
                ChangeType.Modified => "[有差异]",
                _ => "[一致]"
            };

            if (builder.Length > 0)
            {
                builder.AppendLine();
            }

            builder.Append(prefix).Append(' ').Append(line.Text);
        }

        return builder.ToString();
    }
}
