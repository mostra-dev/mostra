import { useParams } from "react-router";

export default function Report() {
  const { id } = useParams();
  return <h1 data-testid="page">Report {id}</h1>;
}
