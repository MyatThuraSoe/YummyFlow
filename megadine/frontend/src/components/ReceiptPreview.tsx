import { Box } from "@mui/material";

interface Props {
  html: string;
  paperWidth?: number;
  fontSize?: string;
}

/** Renders server-produced receipt HTML with thermal-paper styling. */
export default function ReceiptPreview({ html, paperWidth = 80, fontSize = "medium" }: Props) {
  return (
    <Box
      className={`receipt-preview rw-${paperWidth} r-${fontSize}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
