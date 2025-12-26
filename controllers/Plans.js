import Plans from "../models/Plans.js";

export const getPlans = async (req, res) => {
  console.log('Getting Plans...');
  try {
    const plans = await Plans.find(); 
    console.log(plans);
    return res.status(200).json(plans);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not get all plans" });
  }
};
