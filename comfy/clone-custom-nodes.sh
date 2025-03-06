# Function to clone a repository in parallel
clone_repo() {
    local repo_url=$1
    local target_dir=$2
    local commit_hash=$3
    local use_submodules=$4

    echo "Cloning $repo_url to $target_dir"
    
    git clone $repo_url $target_dir \
        && cd $target_dir \
        && git fetch --depth=1 origin $commit_hash \
        && git checkout $commit_hash
    
    # Initialize submodules if needed
    if [ "$use_submodules" = "true" ]; then
        git submodule update --init --recursive --depth 1
    fi
}

# Export the function so it's available to parallel processes
export -f clone_repo

# Create an array of commands to run in parallel
(
# WAS Node Suite
clone_repo https://github.com/WASasquatch/was-node-suite-comfyui ./ComfyUI/custom_nodes/was-node-suite-comfyui ee2e31a1e5fd85ad6f5c36831ffda6fea8f249c7 false &

# Comfyroll Custom Nodes
clone_repo https://github.com/RockOfFire/ComfyUI_Comfyroll_CustomNodes ./ComfyUI/custom_nodes/ComfyUI_Comfyroll_CustomNodes d78b780ae43fcf8c6b7c6505e6ffb4584281ceca false &

# Ultimate SD Upscale
clone_repo https://github.com/ssitu/ComfyUI_UltimateSDUpscale ./ComfyUI/custom_nodes/ComfyUI_UltimateSDUpscale b303386bd363df16ad6706a13b3b47a1c2a1ea49 true &

# Impact Pack
clone_repo https://github.com/ltdrdata/ComfyUI-Impact-Pack.git ./ComfyUI/custom_nodes/ComfyUI-Impact-Pack 21eecb0c03223c7823cb19b318011fba3143da92 true &

# Impact Subpack
clone_repo https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git ./ComfyUI/custom_nodes/ComfyUI-Impact-Subpack 8628fa3a8abf168326afc0ade9666802ca3a0e86 true &

# ControlNet Aux
clone_repo https://github.com/Fannovel16/comfyui_controlnet_aux.git ./ComfyUI/custom_nodes/comfyui_controlnet_aux 1d7cdce8cb771fbc39a432a6338168c12a338ef4 false &

# Efficiency Nodes
clone_repo https://github.com/jags111/efficiency-nodes-comfyui ./ComfyUI/custom_nodes/efficiency-nodes-comfyui b471390b88c9ac8a87c34ad9d882a520296b6fd8 false &

# Face Restore CF
clone_repo https://github.com/mav-rik/facerestore_cf.git ./ComfyUI/custom_nodes/facerestore_cf 67f90bc6be976fb58169866155346b0da13bebee false &

# Masquerade Nodes
clone_repo https://github.com/BadCafeCode/masquerade-nodes-comfyui.git ./ComfyUI/custom_nodes/masquerade-nodes-comfyui 432cb4d146a391b387a0cd25ace824328b5b61cf false &

# Segment Anything
clone_repo https://github.com/storyicon/comfyui_segment_anything.git ./ComfyUI/custom_nodes/comfyui_segment_anything ab6395596399d5048639cdab7e44ec9fae857a93 false &

# Reactor Node
clone_repo https://codeberg.org/Gourieff/comfyui-reactor-node.git ./ComfyUI/custom_nodes/comfyui-reactor-node c94df09b25 false &

# ComfyUI Essentials
clone_repo https://github.com/cubiq/ComfyUI_essentials.git ./ComfyUI/custom_nodes/ComfyUI_essentials 60acb955712ae84959873012a8d9bbfc230499b7 false &

# ComfyUI Logic
clone_repo https://github.com/theUpsider/ComfyUI-Logic.git ./ComfyUI/custom_nodes/ComfyUI-Logic 42d4f3df45fb7f0dd6e2201a14c07d4dd09f235d false &

# IPAdapter Plus
clone_repo https://github.com/cubiq/ComfyUI_IPAdapter_plus.git ./ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus ce9b62165b89fbf8dd3be61057d62a5f8bc29e19 false &

# Safety Checker
clone_repo https://github.com/42lux/ComfyUI-safety-checker.git ./ComfyUI/custom_nodes/ComfyUI-safety-checker 03b73f436f5383e0c6eb0e26fb84d84cff05c5ea false &

# Inpaint Nodes
clone_repo https://github.com/Acly/comfyui-inpaint-nodes.git ./ComfyUI/custom_nodes/comfyui-inpaint-nodes d3655fc0fd7ebb16f17724d6afa98dd9030e10a1 false &

# Automatic CFG
clone_repo https://github.com/Extraltodeus/ComfyUI-AutomaticCFG.git ./ComfyUI/custom_nodes/ComfyUI-AutomaticCFG 8d9b88889a4993c69795585dca7557e83a8a3f56 false &

# RGThree Comfy
clone_repo https://github.com/rgthree/rgthree-comfy.git ./ComfyUI/custom_nodes/rgthree-comfy fb138ddf6ffc0a2696c57a570059f32e87964c1e false &

# Inspire Pack
clone_repo https://github.com/ltdrdata/ComfyUI-Inspire-Pack.git ./ComfyUI/custom_nodes/ComfyUI-Inspire-Pack 9c6065af6d7701fba12f986c52e0b42a5756c6aa false &

# Layer Style
clone_repo https://github.com/chflame163/ComfyUI_LayerStyle.git ./ComfyUI/custom_nodes/ComfyUI_LayerStyle 7b326d13e43fc4022cd80e472c7af67027409b1e false &

# KJ Nodes
clone_repo https://github.com/kijai/ComfyUI-KJNodes.git ./ComfyUI/custom_nodes/ComfyUI-KJNodes 31cb7c1d14f86881ad34654a250d5e7682430fee false &

# BrushNet
clone_repo https://github.com/nullquant/ComfyUI-BrushNet.git ./ComfyUI/custom_nodes/ComfyUI-BrushNet a510effde1ba9df8324f80bb5fc684b5a62792d4 false &

# Allor
clone_repo https://github.com/Nourepide/ComfyUI-Allor.git ./ComfyUI/custom_nodes/ComfyUI-Allor af9caecc2a4e3d432be6aa8b7826da0bc1bb420c false &

# CCSR
clone_repo https://github.com/kijai/ComfyUI-CCSR.git ./ComfyUI/custom_nodes/ComfyUI-CCSR 5fb3cecf3a685e1b1274a4fb6b4dedce8343c74c false &

# Image Filters
clone_repo https://github.com/spacepxl/ComfyUI-Image-Filters.git ./ComfyUI/custom_nodes/ComfyUI-Image-Filters 8ba3fbd46c9ee17553717b4d18aed1a7da37d38d false &

# Custom Scripts
clone_repo https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git ./ComfyUI/custom_nodes/ComfyUI-Custom-Scripts d6657cc1f04539dbeea38d7bf6d73bc025004fa4 false &

# Tiled Diffusion
clone_repo https://github.com/shiimizu/ComfyUI-TiledDiffusion.git ./ComfyUI/custom_nodes/ComfyUI-TiledDiffusion 5b2d0d2c4036218c0d6460efc79790e2a54f9a22 false &

# Florence2
clone_repo https://github.com/kijai/ComfyUI-Florence2.git ./ComfyUI/custom_nodes/ComfyUI-Florence2 a253e73ebb96e76e3012c7a11e1da513d587b188 false &

# Easy Use
clone_repo https://github.com/yolain/ComfyUI-Easy-Use.git ./ComfyUI/custom_nodes/ComfyUI-Easy-Use f641bc15de4ad724a67173972fe1c07373edd976 false &

# Universal Styler
clone_repo https://github.com/KoreTeknology/ComfyUI-Universal-Styler.git ./ComfyUI/custom_nodes/ComfyUI-Universal-Styler cb640977ca2e28c77c49b1c7f857f29ed0253acb false &

# Tensorops
clone_repo https://github.com/un-seen/comfyui-tensorops.git ./ComfyUI/custom_nodes/comfyui-tensorops d34488e3079ecd10db2fe867c3a7af568115faed false &

# TTP Toolset
clone_repo https://github.com/TTPlanetPig/Comfyui_TTP_Toolset.git ./ComfyUI/custom_nodes/Comfyui_TTP_Toolset b3bb08f79050f4590186e88bac3b0a9d9fa79b2e false &

# MTB
clone_repo https://github.com/melMass/comfy_mtb.git ./ComfyUI/custom_nodes/comfy_mtb bc41576facca06110691a25bdd28072bf0cf92d4 false &

# Face Parsing
clone_repo https://github.com/Ryuukeisyou/comfyui_face_parsing.git ./ComfyUI/custom_nodes/comfyui_face_parsing f9f89b3faa2b240257e6a6102469d0a33d031d6d false &

# Tooling Nodes
clone_repo https://github.com/Acly/comfyui-tooling-nodes.git ./ComfyUI/custom_nodes/comfyui-tooling-nodes 50d3479fba55116334ed9fb1ad15f13a9294badf false &

# Segment Anything 2
clone_repo https://github.com/kijai/ComfyUI-segment-anything-2.git ./ComfyUI/custom_nodes/ComfyUI-segment-anything-2 059815ecc55b17ae9b47d15ed9b39b243d73b25f false &

# Inpaint CropAndStitch
clone_repo https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git ./ComfyUI/custom_nodes/ComfyUI-Inpaint-CropAndStitch 2abf837822d761110ac383d9a1cdffcc7ebfab36 false &

# LayerStyle Advance
clone_repo https://github.com/chflame163/ComfyUI_LayerStyle_Advance.git ./ComfyUI/custom_nodes/ComfyUI_LayerStyle_Advance 61660a4b557bcd4399262e18a3f02392baea0b65 false &

# Advanced Reflux Control
clone_repo https://github.com/kaibioinfo/ComfyUI_AdvancedRefluxControl.git ./ComfyUI/custom_nodes/ComfyUI_AdvancedRefluxControl 0a87efa252ae5e8f4af1225b0e19c867f908376a false &

# WaveSpeed
clone_repo https://github.com/chengzeyi/Comfy-WaveSpeed.git ./ComfyUI/custom_nodes/Comfy-WaveSpeed 3db162bb7ad56b84a452a4778527da63793c0e87 false &

# TeaCache
clone_repo https://github.com/welltop-cn/ComfyUI-TeaCache.git ./ComfyUI/custom_nodes/ComfyUI-TeaCache 61636b6503c61ae416c8f4c8f6f38464806a69e5 false &

# Art Venture
clone_repo https://github.com/sipherxyz/comfyui-art-venture.git ./ComfyUI/custom_nodes/comfyui-art-venture 50abaace756b96f5f5dc2c9d72826ef371afd45e false &

# Wait for all background processes to finish
wait
echo "All repositories have been cloned successfully!"
)
