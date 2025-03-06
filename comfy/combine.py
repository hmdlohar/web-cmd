import os

custom_nodes_dir = "./ComfyUI/custom_nodes"
combined_requirements = set()

# Check for requirements.txt in current directory
current_dir_req = "./requirements.txt"
if os.path.isfile(current_dir_req):
    with open(current_dir_req, "r") as f:
        for line in f:
            package = line.split("==")[0].split(">=")[0].split("<=")[0].strip()  # Remove version constraints
            if package and not package.startswith("#"):  # Ignore empty lines and comments
                combined_requirements.add(package)

# Iterate through all subdirectories
for node_dir in os.listdir(custom_nodes_dir):
    req_file = os.path.join(custom_nodes_dir, node_dir, "requirements.txt")

    if os.path.isfile(req_file):
        with open(req_file, "r") as f:
            for line in f:
                package = line.split("==")[0].split(">=")[0].split("<=")[0].strip()  # Remove version constraints
                if package and not package.startswith("#"):  # Ignore empty lines and comments
                    combined_requirements.add(package)

# Save to a single requirements.txt
output_file = os.path.join(custom_nodes_dir, "combined_requirements.txt")
with open(output_file, "w") as f:
    f.write("\n".join(sorted(combined_requirements)))

print(f"Combined requirements saved to {output_file}")
