import Home from "@/features/home/home";

/** New is local and editable immediately. Home and this route share the same
 * scoped startup owner and options sheet; neither waits for folder/model reads
 * to mount an editor, nor creates a backend session before explicit Send. */
export default function NewSession() {
	return <Home newSession />;
}
