import { useParams } from "react-router";

export default function Report() {
  const { id } = useParams();
  return <h2 data-testid="report">Report {id}</h2>;
}
